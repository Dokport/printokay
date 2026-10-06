import { NextRequest, NextResponse } from "next/server";
import { SiteSettings, type FilamentSpool } from "@/lib/settings";
import { readJsonFile, updateJsonFile } from "@/lib/storage";
import { isAdmin } from "@/lib/isAdmin";
import { mergeSettings } from "@/lib/settingsMerge";
import { publicSettings } from "@/lib/publicData";

async function readSettings(): Promise<SiteSettings> {
  const stored = await readJsonFile<Partial<SiteSettings>>("settings.json", {});
  return mergeSettings(stored);
}

// Admin sees stock and what each spool cost; the shop sees name, colour and
// whether it can be ordered.
export async function GET(req: NextRequest) {
  const settings = await readSettings();
  return NextResponse.json(isAdmin(req) ? settings : publicSettings(settings));
}

export async function PUT(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Ugyldige data" }, { status: 400 });
  // Theme colours end up in a raw <style> on every page; only plain hex is allowed.
  for (const key of ["primaryColor", "accentColor", "bgColor"] as const) {
    if (key in body && !(typeof body[key] === "string" && /^#[0-9a-fA-F]{3,8}$/.test(body[key]))) {
      return NextResponse.json({ error: `${key} skal være en farvekode som #2563eb` }, { status: 400 });
    }
  }
  // Merged onto the CURRENT file, not one read earlier: the printer sidecar updates
  // the filament list on a timer, and a stale base would put the old list back.
  const updated = await updateJsonFile<Partial<SiteSettings>>("settings.json", {}, (stored) => {
    const current = mergeSettings(stored);
    return { ...current, ...body, ...(Array.isArray(body.filaments) ? { filaments: keepSyncedFields(body.filaments, current.filaments ?? []) } : {}) };
  });
  return NextResponse.json(updated);
}

/**
 * The public view of settings leaves out each spool's Bambuddy id, stock and cost.
 * Should a list without them ever come back here, saving it must not wipe them — the
 * sync matches spools by that id, and losing it would duplicate every spool. The
 * admin page never edits these three; Bambuddy owns them.
 */
function keepSyncedFields(incoming: FilamentSpool[], stored: FilamentSpool[]): FilamentSpool[] {
  const byId = new Map(stored.map((f) => [f.id, f]));
  return incoming.map((f) => {
    const prev = byId.get(f.id);
    if (!prev) return f;
    return {
      ...f,
      ...(f.sourceId === undefined && prev.sourceId !== undefined ? { sourceId: prev.sourceId } : {}),
      ...(f.remainingGrams === undefined && prev.remainingGrams !== undefined ? { remainingGrams: prev.remainingGrams } : {}),
      ...(f.costPerKg === undefined && prev.costPerKg !== undefined ? { costPerKg: prev.costPerKg } : {}),
    };
  });
}
