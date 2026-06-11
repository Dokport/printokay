/**
 * Aggregated print-history for a product, from its Bambuddy Project archives
 * (sync-token auth). The sidecar sums the project's real prints and posts the
 * rollup here; admin shows "printet N gange · X g · Y kr · sidst <dato>".
 *
 * Body: { productId, printStats: { count, totalGrams?, totalCost?, lastPrintedAt? } }
 *   - totalGrams: grams
 *   - totalCost: DKK øre
 */
import { NextRequest, NextResponse } from "next/server";
import { Product, PrintStats } from "@/lib/products";
import { readJsonFile, writeJsonFile } from "@/lib/storage";
import { isSyncAuthed } from "@/lib/isSyncAuthed";

export async function POST(req: NextRequest) {
  if (!isSyncAuthed(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }

  const { productId, printStats } = await req.json();
  if (!productId || !printStats || typeof printStats !== "object") {
    return NextResponse.json({ error: "productId + printStats påkrævet" }, { status: 400 });
  }

  const products = await readJsonFile<Product[]>("products.json", []);
  const idx = products.findIndex((p) => p.id === productId);
  if (idx === -1) {
    return NextResponse.json({ error: "Produkt ikke fundet" }, { status: 404 });
  }

  const stats: PrintStats = {
    count: Math.max(0, Math.round(Number(printStats.count) || 0)),
    ...(printStats.totalGrams != null ? { totalGrams: Number(printStats.totalGrams) } : {}),
    ...(printStats.totalCost != null ? { totalCost: Math.round(Number(printStats.totalCost)) } : {}),
    ...(printStats.lastPrintedAt ? { lastPrintedAt: String(printStats.lastPrintedAt) } : {}),
  };

  // Skip the Blob write when nothing changed (the sidecar may re-post identical
  // history every cycle) — saves Vercel Blob operations.
  if (JSON.stringify(products[idx].printStats) === JSON.stringify(stats)) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  products[idx] = { ...products[idx], printStats: stats };

  await writeJsonFile("products.json", products);
  return NextResponse.json({ ok: true });
}
