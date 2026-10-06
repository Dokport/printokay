/**
 * Filament sync — Bambuddy → shop (Bambuddy is authoritative for stock).
 *
 * The home-server sidecar POSTs the current spool list pulled from Bambuddy.
 * We upsert by `sourceId` so manually-added shop filaments (which have no
 * sourceId) are preserved untouched, and re-running the sync is idempotent.
 */
import { NextRequest, NextResponse } from "next/server";
import { SiteSettings, FilamentSpool } from "@/lib/settings";
import { updateJsonFile } from "@/lib/storage";
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

export async function POST(req: NextRequest) {
  if (!isSyncAuthed(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }

  const body = await req.json();
  const incoming: IncomingSpool[] = Array.isArray(body?.spools) ? body.spools : [];

  // Recomputed inside the update: the admin may be saving settings at this very
  // moment, and a list worked out from a stale copy would undo their change.
  let counts = { manual: 0, synced: 0, total: 0, unchanged: true };
  await updateJsonFile<Partial<SiteSettings>>("settings.json", {}, (stored) => {
    const settings = mergeSettings(stored);
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
    // Skip the write when nothing changed (synced every cycle, and remaining grams
    // rarely move) — saves Vercel Blob operations.
    const unchanged = JSON.stringify(existing) === JSON.stringify(filaments);
    counts = { manual: manual.length, synced: synced.length, total: filaments.length, unchanged };
    return unchanged ? null : { ...settings, filaments };
  });

  return NextResponse.json({ ok: true, ...counts });
}
