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
      // Per-file download paths (new sidecar uploads both into the Project folder).
      projectPath: p.modelFile ? `/api/sync/models/${p.id}?which=project` : null,
      printPath: p.printFile ? `/api/sync/models/${p.id}?which=print` : null,
      // Backwards compat: old sidecar used downloadPath for the project file.
      downloadPath: p.modelFile ? `/api/sync/models/${p.id}?which=project` : null,
    }));

  // Products whose sliced file lives in Bambuddy: re-read the library file +
  // its archives (real prints) every cycle for authoritative stats and history.
  // No Bambuddy Project needed — we match archives to the file by hash/name.
  const withFiles = products
    .filter((p) => p.bambuddy?.printFileId || p.bambuddyId)
    .map((p) => ({
      id: p.id,
      fileId: p.bambuddy?.printFileId || p.bambuddyId,
      // Whether the product still lacks complete estimate stats (so the sidecar
      // can backfill from the sliced file detail if no real print exists yet).
      needEstimate: statsIncomplete(p),
    }));

  return NextResponse.json({ toUpload, withFiles });
}
