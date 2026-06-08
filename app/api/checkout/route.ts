import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { CartItem, getItemPrice } from "@/lib/cart";
import { DEFAULT_SETTINGS, SiteSettings } from "@/lib/settings";
import { readJsonFile, writeJsonFile } from "@/lib/storage";
import { pendingCartKey } from "@/lib/fulfillment";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: NextRequest) {
  const { items, shippingOptionId }: { items: CartItem[]; shippingOptionId?: string } = await req.json();

  if (!items || items.length === 0) {
    return NextResponse.json({ error: "Ingen varer" }, { status: 400 });
  }

  const stored = await readJsonFile<Partial<SiteSettings>>("settings.json", {});
  const settings = { ...DEFAULT_SETTINGS, ...stored };
  const allOptions = settings.shippingOptions ?? DEFAULT_SETTINGS.shippingOptions;

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

  const lineItems = items.map((item) => {
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

    return {
      price_data: {
        currency: "dkk",
        product_data: {
          name,
          description: descParts.filter(Boolean).join(" — "),
        },
        unit_amount: getItemPrice(item),
      },
      quantity: item.quantity,
    };
  });

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: lineItems,
    mode: "payment",
    shipping_address_collection: { allowed_countries: ["DK"] },
    shipping_options: stripeShippingOptions,
    phone_number_collection: { enabled: true },
    success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/succes?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/kurv`,
  });

  // Stash the full cart server-side, keyed by the session id. The webhook (and
  // the success-page fallback) read this back to build the order for ALL item
  // types — so order creation never depends on the customer's browser.
  await writeJsonFile(pendingCartKey(session.id), {
    items,
    createdAt: new Date().toISOString(),
  });

  return NextResponse.json({ url: session.url });
}
