/**
 * Filament sync — Bambuddy → shop (Bambuddy is authoritative for stock).
 *
 * The home-server sidecar POSTs the current spool list pulled from Bambuddy.
 * We upsert by `sourceId` so manually-added shop filaments (which have no
 * sourceId) are preserved untouched, and re-running the sync is idempotent.
 */
import { NextRequest, NextResponse } from "next/server";
import { SiteSettings, FilamentSpool } from "@/lib/settings";
import { readJsonFile, writeJsonFile } from "@/lib/storage";
import { isSyncAuthed } from "@/lib/isSyncAuthed";
import { mergeSettings } from "@/lib/settingsMerge";

type IncomingSpool = {
  sourceId: string;
  name: string;
  material: string;
  colorHex: string;
  remainingGrams?: number;
  costPerKg?: number;
  inStock: boolean;
};

async function readSettings(): Promise<SiteSettings> {
  const stored = await readJsonFile<Partial<SiteSettings>>("settings.json", {});
  return mergeSettings(stored);
}

export async function POST(req: NextRequest) {
  if (!isSyncAuthed(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }

  const body = await req.json();
  const incoming: IncomingSpool[] = Array.isArray(body?.spools) ? body.spools : [];

  const settings = await readSettings();
  const existing = settings.filaments ?? [];

  // Keep manually-added spools (no sourceId) exactly as they are.
  const manual = existing.filter((f) => !f.sourceId);
  const bySource = new Map(existing.filter((f) => f.sourceId).map((f) => [f.sourceId!, f]));

  const synced: FilamentSpool[] = incoming
    .filter((s) => s.sourceId)
    .map((s) => {
      const prev = bySource.get(s.sourceId);
      return {
        // Stable shop id: reuse if we've seen this spool before.
        id: prev?.id ?? `bambuddy-${s.sourceId}`,
        name: s.name,
        material: s.material,
        colorHex: s.colorHex,
        inStock: s.inStock,
        sourceId: s.sourceId,
        remainingGrams: s.remainingGrams,
        costPerKg: s.costPerKg,
      };
    });

  const filaments = [...manual, ...synced];

  // Skip the Blob write when the filament list is unchanged (synced every cycle,
  // and remaining grams rarely change) — saves Vercel Blob operations.
  if (JSON.stringify(existing) === JSON.stringify(filaments)) {
    return NextResponse.json({
      ok: true,
      manual: manual.length,
      synced: synced.length,
      total: filaments.length,
      unchanged: true,
    });
  }

  await writeJsonFile("settings.json", { ...settings, filaments });

  return NextResponse.json({
    ok: true,
    manual: manual.length,
    synced: synced.length,
    total: filaments.length,
  });
}
