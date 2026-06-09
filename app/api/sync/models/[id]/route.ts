/**
 * Stream a product's stored model file to the sidecar (sync-token auth).
 * The sidecar downloads it here, then uploads it into Bambuddy's library.
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
  const products = await readJsonFile<Product[]>("products.json", []);
  const product = products.find((p) => p.id === id);

  if (!product?.modelFile) {
    return NextResponse.json({ error: "Modelfil ikke fundet" }, { status: 404 });
  }

  const data = await readBinaryFile(product.modelFile);
  if (!data) {
    return NextResponse.json({ error: "Modelfil ikke fundet" }, { status: 404 });
  }

  const ext = product.modelFile.split(".").pop()?.toLowerCase() ?? "3mf";
  const safeName = product.name.replace(/[^a-zA-Z0-9æøåÆØÅ]/g, "_").slice(0, 40);

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeName}.${ext}"`,
    },
  });
}
