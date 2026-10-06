/**
 * What the shop will actually charge for this cart.
 *
 * The cart carries the price each item had when it was added, which goes stale the
 * moment a price changes in admin. Checkout ignores those numbers and prices from
 * settings — so the cart asks here rather than doing the sums itself, and what the
 * customer is shown is what Stripe will ask for.
 */
import { NextRequest, NextResponse } from "next/server";
import { loadPricing, priceCart } from "@/lib/pricing";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ prices: [], subtotal: 0 });
  }

  const pricing = await loadPricing();
  const priced = priceCart(body.items, pricing);
  if (!priced.ok) return NextResponse.json({ error: priced.error }, { status: 400 });

  // Quantities from the checked items — the raw ones could be negative or fractional.
  const subtotal = priced.prices.reduce(
    (sum, price, i) => sum + price * priced.items[i].quantity, 0
  );
  return NextResponse.json({ prices: priced.prices, subtotal });
}
