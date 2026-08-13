/**
 * Extract a product's 3D mesh + colour zones from its stored .3mf, for the
 * customer-facing 3D preview. Public (mesh geometry isn't sensitive).
 *
 * `?f=bin` returns the compact binary format (lib/meshBinary.ts): ~half the bytes
 * of the JSON and zero client-side parsing — the payload is read directly as the
 * typed arrays three.js consumes. The JSON shape remains for older cached bundles.
 *
 * Caching: parsing happens server-side once and the result is cached write-through
 * in Blob (`<base>.mesh.bin` / `.mesh.json`). The client always calls with
 * `?v=<blob path>`, which changes whenever the model file changes — so versioned
 * responses are also marked immutable and cached on Vercel's edge: after the first
 * visitor, the mesh is served from the CDN with no function or Blob read at all.
 */
import { NextRequest, NextResponse } from "next/server";
import { Product } from "@/lib/products";
import { readJsonFile, writeJsonFile, readBinaryFile, writeBinaryFile } from "@/lib/storage";
import { parseThreeMf, type ParsedMesh } from "@/lib/threemf";
import { encodeMeshBinary } from "@/lib/meshBinary";

const cacheControl = (versioned: boolean) =>
  versioned
    ? "public, max-age=31536000, s-maxage=31536000, immutable"
    : "public, max-age=3600";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const wantBinary = req.nextUrl.searchParams.get("f") === "bin";
  const versioned = !!req.nextUrl.searchParams.get("v");

  const products = await readJsonFile<Product[]>("products.json", []);
  const product = products.find((p) => p.id === id);

  // Prefer the (posed/light) preview model for display; fall back to the print model.
  const displayFile = product?.previewModel || product?.modelFile;
  if (!displayFile) {
    return NextResponse.json({ error: "Ingen 3D-model" }, { status: 404 });
  }

  const cacheBase = displayFile.replace(/\.[^.]+$/, "");

  // ── Cached? ──
  if (wantBinary) {
    const cached = await readBinaryFile(cacheBase + ".mesh.bin");
    if (cached) {
      return new NextResponse(new Uint8Array(cached), {
        headers: {
          "Content-Type": "application/octet-stream",
          "Cache-Control": cacheControl(versioned),
        },
      });
    }
  } else {
    const cached = await readJsonFile<ParsedMesh | null>(cacheBase + ".mesh.json", null);
    if (cached) {
      return NextResponse.json(cached, {
        headers: { "Cache-Control": cacheControl(versioned) },
      });
    }
  }

  // ── Parse (reusing the other format's cache when possible, to skip the 3mf) ──
  let mesh = wantBinary
    ? await readJsonFile<ParsedMesh | null>(cacheBase + ".mesh.json", null)
    : null;

  if (!mesh) {
    const raw = await readBinaryFile(displayFile);
    if (!raw) {
      return NextResponse.json({ error: "Modelfil ikke fundet" }, { status: 404 });
    }
    try {
      mesh = parseThreeMf(new Uint8Array(raw));
    } catch (err) {
      console.error("3mf parse error:", err);
      return NextResponse.json({ error: "Kunne ikke læse modellen" }, { status: 422 });
    }
    if (!mesh.positions.length) {
      return NextResponse.json({ error: "Modellen indeholder ingen geometri" }, { status: 422 });
    }
  }

  if (wantBinary) {
    const bin = Buffer.from(encodeMeshBinary(mesh));
    writeBinaryFile(cacheBase + ".mesh.bin", bin).catch(() => {});
    return new NextResponse(new Uint8Array(bin), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": cacheControl(versioned),
      },
    });
  }

  // Write-through cache (best effort).
  writeJsonFile(cacheBase + ".mesh.json", mesh).catch(() => {});
  return NextResponse.json(mesh, {
    headers: { "Cache-Control": cacheControl(versioned) },
  });
}
