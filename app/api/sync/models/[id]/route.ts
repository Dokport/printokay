/**
 * Stream a product's stored 3MF to the sidecar (sync-token auth).
 * The sidecar downloads it here, then uploads it into Bambuddy's library.
 *
 * ?which=project (default) → the project file (mesh, .3mf)
 * ?which=print             → the sliced print file (.gcode.3mf, print + stats)
 */
import { NextRequest, NextResponse } from "next/server";
import { Product } from "@/lib/products";
import { readJsonFile, readBinaryFile } from "@/lib/storage";
import { isSyncAuthed } from "@/lib/isSyncAuthed";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isSyncAuthed(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }

  const { id } = await params;
  const which = req.nextUrl.searchParams.get("which") === "print" ? "print" : "project";
  const products = await readJsonFile<Product[]>("products.json", []);
  const product = products.find((p) => p.id === id);

  const file = which === "print" ? product?.printFile : product?.modelFile;
  if (!file) {
    return NextResponse.json({ error: "Fil ikke fundet" }, { status: 404 });
  }

  const data = await readBinaryFile(file);
  if (!data) {
    return NextResponse.json({ error: "Fil ikke fundet" }, { status: 404 });
  }

  // Sliced files are .gcode.3mf; project files are .3mf.
  const ext = which === "print" ? "gcode.3mf" : file.split(".").pop()?.toLowerCase() ?? "3mf";
  const safeBase = (product?.name ?? "model").replace(/[^a-zA-Z0-9æøåÆØÅ]/g, "_").slice(0, 40);
  const suffix = which === "print" ? " - print" : " - projekt";

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeBase}${suffix}.${ext}"`,
    },
  });
}
