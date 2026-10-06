/**
 * Confirm a Bambuddy folder/file rename was applied (sync-token auth).
 * Updates the remembered name/category so the rename isn't repeated.
 * Body: { productId }
 */
import { NextRequest, NextResponse } from "next/server";
import { mutateProducts } from "@/lib/productStore";
import { isSyncAuthed } from "@/lib/isSyncAuthed";

export async function POST(req: NextRequest) {
  if (!isSyncAuthed(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }

  const { productId } = await req.json().catch(() => ({}));
  if (!productId) {
    return NextResponse.json({ error: "productId påkrævet" }, { status: 400 });
  }

  const found = await mutateProducts((products) => {
    const idx = products.findIndex((p) => p.id === productId);
    if (idx === -1 || !products[idx].bambuddy) return { result: false, changed: false };
    products[idx] = {
      ...products[idx],
      bambuddy: {
        ...products[idx].bambuddy,
        syncedName: products[idx].name,
        syncedCategory: products[idx].category,
      },
    };
    return { result: true, changed: true };
  });
  if (!found) return NextResponse.json({ error: "Produkt/kobling ikke fundet" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
