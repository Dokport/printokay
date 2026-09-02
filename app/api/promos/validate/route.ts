/**
 * Public: does this code work on this cart? Used only to give the cart something
 * to show — /api/checkout re-runs the exact same check before any discount is
 * real, so a forged answer here buys nothing.
 */
import { NextRequest, NextResponse } from "next/server";
import { checkPromo, formatPromoCode, normalizePromoCode } from "@/lib/promos";
import type { CartItem } from "@/lib/cart";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const items: CartItem[] = Array.isArray(body.items) ? body.items : [];
  const holderId = typeof body.holderId === "string" ? body.holderId : undefined;
  const result = await checkPromo(String(body.code ?? ""), items, holderId);

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 200 });
  }
  return NextResponse.json({
    ok: true,
    code: formatPromoCode(normalizePromoCode(String(body.code))),
    discount: result.discount,
    label: "Gratis nøglering",
  });
}
