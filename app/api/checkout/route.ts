import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { CartItem } from "@/lib/cart";
import { writeJsonFile } from "@/lib/storage";
import { loadPricing, priceCart } from "@/lib/pricing";
import { pendingCartKey } from "@/lib/fulfillment";
import {
  checkPromo, reservePromo, releasePromo, normalizePromoCode, setReservationSession,
} from "@/lib/promos";
import { joinTextLines } from "@/lib/textpaths";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: NextRequest) {
  const { items: rawItems, shippingOptionId, promoCode, holderId }: {
    items: unknown;
    shippingOptionId?: string;
    promoCode?: string;
    /** Stable per-browser id, so a customer can re-enter their own checkout. */
    holderId?: string;
  } = await req.json().catch(() => ({}));

  // Every amount below comes from here, never from the request body — and so does
  // every item: priceCart validates the cart and rebuilds each item from the shop's
  // own data. From here on `items` is that rebuilt list, not what was posted.
  const pricing = await loadPricing();
  const priced = priceCart(rawItems, pricing);
  if (!priced.ok) return NextResponse.json({ error: priced.error }, { status: 400 });
  const items: CartItem[] = priced.items;
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
  const reservationId = holderId || `checkout-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  let promo: { code: string; discount: number; cartKey: string } | null = null;
  if (promoCode && normalizePromoCode(promoCode)) {
    const check = await checkPromo(promoCode, items, holderId, pricing);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: 400 });
    promo = { code: check.promo.code, discount: check.discount, cartKey: check.cartKey };

    // Coming back to check out again is allowed — but the session made last time
    // still carries the discount, and every one left open is another free keyring.
    // Expire it first. If it can't be expired because it was already paid, this
    // code is spent.
    const previous = check.promo.reservedBy === reservationId ? check.promo.reservedSession : undefined;
    if (previous) {
      const blocked = await retirePreviousSession(previous);
      if (blocked) return NextResponse.json({ error: blocked }, { status: 400 });
    }
  }

  const lineItems = items.flatMap((item, i) => {
    const isKeyring = !!item.keyringData;
    const fd = item.fidgetData;
    const name = isKeyring
      ? `Nøglering: "${joinTextLines(item.keyringData!.text)}" (${item.keyringData!.sizeLabel})`
      : fd
        ? `Fidget clicker ${fd.cols}×${fd.rows}${fd.labels.some(Boolean) ? ` "${fd.labels.filter(Boolean).join(" ")}"` : ""}`
        : item.product.name;

    const descParts: (string | null)[] = [];
    if (isKeyring) {
      const kd = item.keyringData!;
      descParts.push(`Font: ${kd.font.replace(/-/g, " ")}`);
      descParts.push(`Base: ${kd.baseFilamentName}`);
      descParts.push(`Tekst: ${kd.textFilamentName}`);
    } else if (fd) {
      descParts.push(`${fd.cols * fd.rows} × ${fd.switchLabel}`);
      if (fd.keyring) descParts.push("Med nøglering");
      descParts.push(`Kasse: ${fd.boxFilamentName}`);
      descParts.push(`Knapper: ${fd.capFilamentName}`);
      descParts.push(`Tekst: ${fd.textFilamentName}`);
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

  // From here on this is the one session the discount may be paid out on.
  if (promo) await setReservationSession(promo.code, reservationId, session.id);

  // Stash the full cart server-side, keyed by the session id. The webhook (and
  // the success-page fallback) read this back to build the order for ALL item
  // types — so order creation never depends on the customer's browser.
  try {
    await writeJsonFile(pendingCartKey(session.id), {
      items,
      createdAt: new Date().toISOString(),
      ...(promo ? { promo: { code: promo.code, discount: promo.discount } } : {}),
    });
  } catch (err) {
    // The order is built from this stash. Without it a customer could pay and no
    // order would ever appear — so take the payment page back before they see it.
    console.error("Kurven kunne ikke gemmes — betalingen trækkes tilbage:", err);
    await stripe.checkout.sessions.expire(session.id).catch(() => {});
    if (promo) await releasePromo(promo.code, reservationId);
    return NextResponse.json({ error: "Kunne ikke starte betalingen. Prøv igen." }, { status: 500 });
  }

  return NextResponse.json({ url: session.url });
}

/**
 * Expire a checkout session that held a promo reservation. Returns an error to
 * show the customer if the code can no longer be used, or null if it is free.
 *
 * Fails closed: a session we cannot account for is treated as still able to pay.
 */
async function retirePreviousSession(sessionId: string): Promise<string | null> {
  try {
    await stripe.checkout.sessions.expire(sessionId);
    return null;
  } catch {
    // Already expired is fine; already paid means the code is spent. Anything
    // else — Stripe down, unknown id — is not safe to wave through.
    try {
      const s = await stripe.checkout.sessions.retrieve(sessionId);
      if (s.status === "expired") return null;
      if (s.status === "complete") return "Denne promokode er allerede brugt.";
    } catch { /* fall through */ }
    return "Promokoden kunne ikke frigives lige nu. Prøv igen om lidt.";
  }
}
