import { NextRequest, NextResponse } from "next/server";
import { SiteSettings, DEFAULT_SETTINGS } from "@/lib/settings";
import { readJsonFile, writeJsonFile } from "@/lib/storage";
import { isAdmin } from "@/lib/isAdmin";

async function readSettings(): Promise<SiteSettings> {
  const stored = await readJsonFile<Partial<SiteSettings>>("settings.json", {});
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function GET() {
  return NextResponse.json(await readSettings());
}

export async function PUT(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  const body = await req.json();
  const updated = { ...(await readSettings()), ...body };
  await writeJsonFile("settings.json", updated);
  return NextResponse.json(updated);
}
