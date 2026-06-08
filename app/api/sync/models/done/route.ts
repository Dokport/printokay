/**
 * Mark a product's model as uploaded to Bambuddy (sync-token auth).
 * Body: { productId, bambuddyId }
 */
import { NextRequest, NextResponse } from "next/server";
import { Product } from "@/lib/products";
import { readJsonFile, writeJsonFile } from "@/lib/storage";
import { isSyncAuthed } from "@/lib/isSyncAuthed";

export async function POST(req: NextRequest) {
  if (!isSyncAuthed(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }

  const { productId, bambuddyId } = await req.json();
  if (!productId) {
    return NextResponse.json({ error: "productId påkrævet" }, { status: 400 });
  }

  const products = await readJsonFile<Product[]>("products.json", []);
  const idx = products.findIndex((p) => p.id === productId);
  if (idx === -1) {
    return NextResponse.json({ error: "Produkt ikke fundet" }, { status: 404 });
  }

  products[idx] = {
    ...products[idx],
    modelSyncedAt: new Date().toISOString(),
    ...(bambuddyId ? { bambuddyId: String(bambuddyId) } : {}),
  };

  await writeJsonFile("products.json", products);
  return NextResponse.json({ ok: true });
}
