/**
 * Model sync state for the home-server sidecar (sync-token auth).
 *
 * Returns the per-product work the sidecar needs to do:
 *  - toUpload:      has file(s) but no Bambuddy Project yet. The sidecar creates
 *                   a Project + linked folder (printOKAY/<Kategori>/<Produkt>) and
 *                   uploads BOTH the project (.3mf mesh) and sliced (.gcode.3mf)
 *                   files into it.
 *  - awaitingStats: uploaded (has a Bambuddy id) but production stats are still
 *                   incomplete. We keep re-fetching until print time, filament
 *                   grams AND material cost are all present — so e.g. adding a
 *                   cost/kg in Bambuddy later still flows through.
 *
 * Legacy products already uploaded the old single-file way (modelSyncedAt set,
 * no bambuddy.syncedAt) are left untouched.
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
    .filter(
      (p) =>
        (p.modelFile || p.printFile) &&
        !p.bambuddy?.syncedAt &&
        !p.modelSyncedAt // skip legacy single-file uploads
    )
    .map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category || "",
      hasProject: !!p.modelFile,
      hasPrint: !!p.printFile,
      // Per-file download paths (the sidecar uploads both into the Project folder).
      projectPath: p.modelFile ? `/api/sync/models/${p.id}?which=project` : null,
      printPath: p.printFile ? `/api/sync/models/${p.id}?which=print` : null,
    }));

  const awaitingStats = products
    .filter((p) => (p.bambuddy?.printFileId || p.bambuddyId) && statsIncomplete(p))
    .map((p) => ({
      id: p.id,
      // Prefer the sliced print file for stats; fall back to legacy id.
      bambuddyId: p.bambuddy?.printFileId || p.bambuddy?.projectFileId || p.bambuddyId,
    }));

  return NextResponse.json({ toUpload, awaitingStats });
}
