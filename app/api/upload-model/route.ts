/**
 * Model-file upload (admin only).
 *
 * Stores the full model file (primarily multi-material .3mf from MakerWorld, or
 * .stl) UNCHANGED under `models/` and returns its storage path. Nothing is
 * re-encoded or reduced — all multi-material/colour-zone data is preserved so it
 * can later drive a 3D colour preview and be forwarded to Bambuddy as-is.
 */
import { NextRequest, NextResponse } from "next/server";
import { writeBinaryFile } from "@/lib/storage";
import { isAdmin } from "@/lib/isAdmin";

const ALLOWED = ["3mf", "stl"];

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Ingen fil" }, { status: 400 });

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED.includes(ext)) {
    return NextResponse.json(
      { error: "Kun .3mf og .stl er tilladt" },
      { status: 400 }
    );
  }

  const filename = `models/${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    await writeBinaryFile(filename, buffer);
  } catch (err) {
    console.error("Model upload error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload fejlede" },
      { status: 500 }
    );
  }

  // Return the storage path (not a browser URL) — the sidecar fetches it via
  // the authenticated /api/sync/models/[id] route.
  return NextResponse.json({ path: filename, name: file.name, size: buffer.length });
}
