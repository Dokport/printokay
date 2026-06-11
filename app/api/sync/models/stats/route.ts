/**
 * Write Bambuddy-computed production stats back onto a product (sync-token auth).
 *
 * Bambuddy is authoritative for print time, filament usage and material cost, so
 * these overwrite the product's fields. The selling price is never touched.
 *
 * Body: { productId, printMinutes?, filamentGrams?, materialCost?, source? }
 *   - printMinutes: minutes
 *   - filamentGrams: grams
 *   - materialCost: DKK øre
 *   - source: "estimate" (from a sliced file) | "actual" (from a real print/archive)
 *
 * Precedence: once a product has "actual" stats (a real print happened), an
 * "estimate" update is ignored so we never regress to predicted numbers.
 */
import { NextRequest, NextResponse } from "next/server";
import { Product } from "@/lib/products";
import { readJsonFile, writeJsonFile } from "@/lib/storage";
import { isSyncAuthed } from "@/lib/isSyncAuthed";

export async function POST(req: NextRequest) {
  if (!isSyncAuthed(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }

  const { productId, printMinutes, filamentGrams, materialCost, source } = await req.json();
  if (!productId) {
    return NextResponse.json({ error: "productId påkrævet" }, { status: 400 });
  }

  const products = await readJsonFile<Product[]>("products.json", []);
  const idx = products.findIndex((p) => p.id === productId);
  if (idx === -1) {
    return NextResponse.json({ error: "Produkt ikke fundet" }, { status: 404 });
  }

  const incoming: "estimate" | "actual" = source === "actual" ? "actual" : "estimate";

  // Don't let an estimate overwrite stats that came from a real print.
  if (incoming === "estimate" && products[idx].statsSource === "actual") {
    return NextResponse.json({ ok: true, skipped: "actual stats present" });
  }

  const cur = products[idx];
  const next = {
    ...cur,
    ...(printMinutes != null ? { printMinutes: Math.round(Number(printMinutes)) } : {}),
    ...(filamentGrams != null ? { filamentGrams: Number(filamentGrams) } : {}),
    ...(materialCost != null ? { materialCost: Math.round(Number(materialCost)) } : {}),
    statsSource: incoming,
  };

  // Skip the Blob write when the actual values didn't change (the sidecar may
  // re-post identical stats every cycle) — saves Vercel Blob operations.
  const unchanged =
    next.printMinutes === cur.printMinutes &&
    next.filamentGrams === cur.filamentGrams &&
    next.materialCost === cur.materialCost &&
    next.statsSource === cur.statsSource;
  if (unchanged) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  products[idx] = { ...next, bambuddyStatsAt: new Date().toISOString() };

  await writeJsonFile("products.json", products);
  return NextResponse.json({ ok: true });
}
