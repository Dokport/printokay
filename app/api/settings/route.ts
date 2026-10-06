import { NextRequest, NextResponse } from "next/server";
import { SiteSettings } from "@/lib/settings";
import { readJsonFile, updateJsonFile } from "@/lib/storage";
import { isAdmin } from "@/lib/isAdmin";
import { mergeSettings } from "@/lib/settingsMerge";

async function readSettings(): Promise<SiteSettings> {
  const stored = await readJsonFile<Partial<SiteSettings>>("settings.json", {});
  return mergeSettings(stored);
}

export async function GET() {
  return NextResponse.json(await readSettings());
}

export async function PUT(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  const body = await req.json();
  // Merged onto the CURRENT file, not one read earlier: the printer sidecar updates
  // the filament list on a timer, and a stale base would put the old list back.
  const updated = await updateJsonFile<Partial<SiteSettings>>("settings.json", {}, (stored) => ({
    ...mergeSettings(stored),
    ...body,
  }));
  return NextResponse.json(updated);
}
