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
import type { CartItem } from "@/lib/cart";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const items: CartItem[] = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) return NextResponse.json({ prices: [], subtotal: 0 });

  const pricing = await loadPricing();
  const priced = priceCart(items, pricing);
  if (!priced.ok) return NextResponse.json({ error: priced.error }, { status: 400 });

  const subtotal = priced.prices.reduce(
    (sum, price, i) => sum + price * (items[i].quantity || 1), 0
  );
  return NextResponse.json({ prices: priced.prices, subtotal });
}
