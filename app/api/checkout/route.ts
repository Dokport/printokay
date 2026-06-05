import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { CartItem } from "@/lib/cart";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

export async function POST(req: NextRequest) {
  const { items }: { items: CartItem[] } = await req.json();

  if (!items || items.length === 0) {
    return NextResponse.json({ error: "Ingen varer" }, { status: 400 });
  }

  const lineItems = items.map((item) => ({
    price_data: {
      currency: "dkk",
      product_data: {
        name: item.product.name,
        description: item.product.description,
        ...(item.note ? { description: `${item.product.description} — Note: ${item.note}` } : {}),
      },
      unit_amount: item.product.price,
    },
    quantity: item.quantity,
  }));

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: lineItems,
    mode: "payment",
    shipping_address_collection: { allowed_countries: ["DK"] },
    shipping_options: [
      {
        shipping_rate_data: {
          type: "fixed_amount",
          fixed_amount: { amount: 4900, currency: "dkk" },
          display_name: "PostNord Pakke",
          delivery_estimate: {
            minimum: { unit: "business_day", value: 3 },
            maximum: { unit: "business_day", value: 7 },
          },
        },
      },
      {
        shipping_rate_data: {
          type: "fixed_amount",
          fixed_amount: { amount: 0, currency: "dkk" },
          display_name: "Afhentning (aftales)",
          delivery_estimate: {
            minimum: { unit: "business_day", value: 1 },
            maximum: { unit: "business_day", value: 3 },
          },
        },
      },
    ],
    success_url: `${process.env.NEXT_PUBLIC_BASE_URL}/succes?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.NEXT_PUBLIC_BASE_URL}/kurv`,
  });

  return NextResponse.json({ url: session.url });
}
