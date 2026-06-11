/**
 * Printer list sync: the sidecar pushes Bambuddy's printers here so admin can
 * pick a target when sending something to print (sync-token auth).
 * Body: { printers: [{ id, name, model?, isActive? }] }
 */
import { NextRequest, NextResponse } from "next/server";
import { Printer } from "@/lib/products";
import { readJsonFile, writeJsonFile } from "@/lib/storage";
import { isSyncAuthed } from "@/lib/isSyncAuthed";

export async function POST(req: NextRequest) {
  if (!isSyncAuthed(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }

  const { printers } = await req.json();
  if (!Array.isArray(printers)) {
    return NextResponse.json({ error: "printers[] påkrævet" }, { status: 400 });
  }

  const clean: Printer[] = printers
    .filter((p) => p && p.id != null)
    .map((p) => ({
      id: String(p.id),
      name: String(p.name ?? p.id),
      ...(p.model ? { model: String(p.model) } : {}),
      ...(p.isActive != null ? { isActive: !!p.isActive } : {}),
    }));

  // Skip the Blob write when the printer list is unchanged (synced every cycle).
  const cur = await readJsonFile<Printer[]>("printers.json", []);
  if (JSON.stringify(cur) === JSON.stringify(clean)) {
    return NextResponse.json({ ok: true, count: clean.length, unchanged: true });
  }

  await writeJsonFile("printers.json", clean);
  return NextResponse.json({ ok: true, count: clean.length });
}
