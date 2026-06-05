import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { SiteSettings, DEFAULT_SETTINGS } from "@/lib/settings";
import { isAdmin } from "@/lib/isAdmin";

const DATA_PATH = path.join(process.cwd(), "data", "settings.json");

function readSettings(): SiteSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(DATA_PATH, "utf-8")) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(settings: SiteSettings) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(settings, null, 2));
}

export async function GET() {
  return NextResponse.json(readSettings());
}

export async function PUT(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  const body = await req.json();
  const updated = { ...readSettings(), ...body };
  writeSettings(updated);
  return NextResponse.json(updated);
}
