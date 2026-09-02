import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { CartItem } from "@/lib/cart";
import { writeJsonFile } from "@/lib/storage";
import { loadPricing, priceCart } from "@/lib/pricing";
import { pendingCartKey } from "@/lib/fulfillment";
import { checkPromo, reservePromo, releasePromo, normalizePromoCode } from "@/lib/promos";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: NextRequest) {
  const { items, shippingOptionId, promoCode, holderId }: {
    items: CartItem[];
    shippingOptionId?: string;
    promoCode?: string;
    /** Stable per-browser id, so a customer can re-enter their own checkout. */
    holderId?: string;
  } = await req.json();

  if (!items || items.length === 0) {
    return NextResponse.json({ error: "Ingen varer" }, { status: 400 });
  }

  // Every amount below comes from here, never from the request body.
  const pricing = await loadPricing();
  const priced = priceCart(items, pricing);
  if (!priced.ok) return NextResponse.json({ error: priced.error }, { status: 400 });
  const unitPrices = priced.prices;

  const settings = pricing.settings;
  const allOptions = settings.shippingOptions ?? [];

  // Use selected option if provided, otherwise all options
  const optionsToUse = shippingOptionId
    ? allOptions.filter((o) => o.id === shippingOptionId)
    : allOptions;

  const stripeShippingOptions = (optionsToUse.length > 0 ? optionsToUse : allOptions).map((opt) => ({
    shipping_rate_data: {
      type: "fixed_amount" as const,
      fixed_amount: { amount: opt.price, currency: "dkk" },
      display_name: opt.name,
      delivery_estimate: {
        minimum: { unit: "business_day" as const, value: opt.minDays },
        maximum: { unit: "business_day" as const, value: opt.maxDays },
      },
    },
  }));

  // Re-validate the code here from scratch. Whatever the cart page decided to
  // display is irrelevant — this is the only check that can move money.
  let promo: { code: string; discount: number; cartKey: string } | null = null;
  if (promoCode && normalizePromoCode(promoCode)) {
    const check = await checkPromo(promoCode, items, holderId, pricing);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
    promo = { code: check.promo.code, discount: check.discount, cartKey: check.cartKey };
  }

  const lineItems = items.flatMap((item, i) => {
    const isKeyring = !!item.keyringData;
    const name = isKeyring
      ? `Nøglering: "${item.keyringData!.text}" (${item.keyringData!.sizeLabel})`
      : item.product.name;

    const descParts: (string | null)[] = [];
    if (isKeyring) {
      const kd = item.keyringData!;
      descParts.push(`Font: ${kd.font.replace(/-/g, " ")}`);
      descParts.push(`Base: ${kd.baseFilamentName}`);
      descParts.push(`Tekst: ${kd.textFilamentName}`);
    } else {
      descParts.push(item.product.description);
      if (item.colorChoices?.length) {
        item.colorChoices.forEach((c) => descParts.push(`${c.slotLabel}: ${c.filamentName}`));
      }
      if (item.note) descParts.push(`Note: ${item.note}`);
    }

    const unitAmount = unitPrices[i];
    const description = descParts.filter(Boolean).join(" — ");
    const priceData = (amount: number, suffix = "") => ({
      price_data: {
        currency: "dkk" as const,
        product_data: { name: name + suffix, description },
        unit_amount: amount,
      },
    });

    // The promo covers exactly one unit. If the customer ordered several of the
    // discounted keyring, split the line so the rest is still charged.
    if (promo && item.cartKey === promo.cartKey) {
      const free = [{ ...priceData(0, " — gratis med promokode"), quantity: 1 }];
      return item.quantity > 1
        ? [...free, { ...priceData(unitAmount), quantity: item.quantity - 1 }]
        : free;
    }

    return [{ ...priceData(unitAmount), quantity: item.quantity }];
  });

  // Hold the code before Stripe is involved, so two people cannot both reach a
  // payment page believing the same code is theirs. Held by browser, so coming
  // back from an abandoned payment re-acquires the customer's own reservation.
  const reservationId = holderId || `checkout-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  if (promo && !(await reservePromo(promo.code, reservationId))) {
    return NextResponse.json(
      { error: "Promokoden blev lige brugt. Prøv igen." },
      { status: 400 }
    );
  }

  const itemsTotal = lineItems.reduce(
    (sum, li) => sum + li.price_data.unit_amount * li.quantity, 0
  );
  const cheapestShipping = Math.min(
    ...(optionsToUse.length > 0 ? optionsToUse : allOptions).map((o) => o.price)
  );

  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.create({
      // A 0 kr order (free keyring + free pickup) collects no payment at all, so
      // asking Stripe for a card would strand the customer on an unfillable form.
      ...(itemsTotal + cheapestShipping > 0
        ? { payment_method_types: ["card"] as const }
        : {}),
      line_items: lineItems,
      mode: "payment",
      shipping_address_collection: { allowed_countries: ["DK"] },
      shipping_options: stripeShippingOptions,
      phone_number_collection: { enabled: true },
      success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/succes?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/kurv`,
    });
  } catch (err) {
    // Give the code back — the customer never got a payment page.
    if (promo) await releasePromo(promo.code, reservationId);
    console.error("Stripe-session kunne ikke oprettes:", err);
    return NextResponse.json({ error: "Kunne ikke starte betalingen." }, { status: 500 });
  }

  // Stash the full cart server-side, keyed by the session id. The webhook (and
  // the success-page fallback) read this back to build the order for ALL item
  // types — so order creation never depends on the customer's browser.
  await writeJsonFile(pendingCartKey(session.id), {
    items,
    createdAt: new Date().toISOString(),
    ...(promo ? { promo: { code: promo.code, discount: promo.discount } } : {}),
  });

  return NextResponse.json({ url: session.url });
}
