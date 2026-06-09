/**
 * Model sync state for the home-server sidecar (sync-token auth).
 *
 * Returns the per-product work the sidecar needs to do:
 *  - toUpload:      has a model file but hasn't been uploaded to Bambuddy yet
 *  - awaitingStats: uploaded (has bambuddyId) but production stats are still
 *                   incomplete. We keep re-fetching until print time, filament
 *                   grams AND material cost are all present — so e.g. adding a
 *                   cost/kg in Bambuddy later still flows through.
 */
import { NextRequest, NextResponse } from "next/server";
import { Product } from "@/lib/products";
import { readJsonFile } from "@/lib/storage";
import { isSyncAuthed } from "@/lib/isSyncAuthed";

const statsIncomplete = (p: Product) =>
  p.printMinutes == null || p.filamentGrams == null || p.materialCost == null;

export async function GET(req: NextRequest) {
  if (!isSyncAuthed(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }

  const products = await readJsonFile<Product[]>("products.json", []);

  const toUpload = products
    .filter((p) => p.modelFile && !p.modelSyncedAt)
    .map((p) => ({ id: p.id, name: p.name, downloadPath: `/api/sync/models/${p.id}` }));

  const awaitingStats = products
    .filter((p) => p.bambuddyId && statsIncomplete(p))
    .map((p) => ({ id: p.id, bambuddyId: p.bambuddyId }));

  return NextResponse.json({ toUpload, awaitingStats });
}
