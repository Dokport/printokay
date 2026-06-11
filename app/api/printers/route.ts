/**
 * Printer list for the admin UI (admin auth). Read-only; populated by the
 * sidecar via /api/sync/printers.
 */
import { NextRequest, NextResponse } from "next/server";
import { Printer } from "@/lib/products";
import { readJsonFile } from "@/lib/storage";
import { isAdmin } from "@/lib/isAdmin";

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  return NextResponse.json(await readJsonFile<Printer[]>("printers.json", []));
}
