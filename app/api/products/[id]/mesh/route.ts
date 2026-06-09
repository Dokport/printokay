/**
 * Extract a product's 3D mesh + colour zones from its stored .3mf, for the
 * customer-facing 3D preview. Public (mesh geometry isn't sensitive).
 *
 * The .3mf is ~1 MB (with gcode/thumbnails); parsing happens server-side and the
 * compact result is cached write-through in Blob as `<base>.mesh.json`, so repeat
 * loads are fast.
 */
import { NextRequest, NextResponse } from "next/server";
import { Product } from "@/lib/products";
import { readJsonFile, writeJsonFile, readBinaryFile } from "@/lib/storage";
import { parseThreeMf, type ParsedMesh } from "@/lib/threemf";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const products = await readJsonFile<Product[]>("products.json", []);
  const product = products.find((p) => p.id === id);

  if (!product?.modelFile) {
    return NextResponse.json({ error: "Ingen 3D-model" }, { status: 404 });
  }

  const cacheKey = product.modelFile.replace(/\.[^.]+$/, "") + ".mesh.json";

  // Cached?
  const cached = await readJsonFile<ParsedMesh | null>(cacheKey, null);
  if (cached) {
    return NextResponse.json(cached, {
      headers: { "Cache-Control": "public, max-age=3600" },
    });
  }

  const raw = await readBinaryFile(product.modelFile);
  if (!raw) {
    return NextResponse.json({ error: "Modelfil ikke fundet" }, { status: 404 });
  }

  let mesh: ParsedMesh;
  try {
    mesh = parseThreeMf(new Uint8Array(raw));
  } catch (err) {
    console.error("3mf parse error:", err);
    return NextResponse.json({ error: "Kunne ikke læse modellen" }, { status: 422 });
  }

  if (!mesh.positions.length) {
    return NextResponse.json({ error: "Modellen indeholder ingen geometri" }, { status: 422 });
  }

  // Write-through cache (best effort).
  writeJsonFile(cacheKey, mesh).catch(() => {});

  return NextResponse.json(mesh, {
    headers: { "Cache-Control": "public, max-age=3600" },
  });
}
