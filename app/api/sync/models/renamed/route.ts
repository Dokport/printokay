/**
 * Confirm a Bambuddy folder/file rename was applied (sync-token auth).
 * Updates the remembered name/category so the rename isn't repeated.
 * Body: { productId }
 */
import { NextRequest, NextResponse } from "next/server";
import { Product } from "@/lib/products";
import { readJsonFile, writeJsonFile } from "@/lib/storage";
import { isSyncAuthed } from "@/lib/isSyncAuthed";

export async function POST(req: NextRequest) {
  if (!isSyncAuthed(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }

  const { productId } = await req.json();
  if (!productId) {
    return NextResponse.json({ error: "productId påkrævet" }, { status: 400 });
  }

  const products = await readJsonFile<Product[]>("products.json", []);
  const idx = products.findIndex((p) => p.id === productId);
  if (idx === -1 || !products[idx].bambuddy) {
    return NextResponse.json({ error: "Produkt/kobling ikke fundet" }, { status: 404 });
  }

  products[idx] = {
    ...products[idx],
    bambuddy: {
      ...products[idx].bambuddy,
      syncedName: products[idx].name,
      syncedCategory: products[idx].category,
    },
  };

  await writeJsonFile("products.json", products);
  return NextResponse.json({ ok: true });
}
