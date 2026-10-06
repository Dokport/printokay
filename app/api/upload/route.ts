import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import fs from "fs";
import path from "path";
import { isAdmin } from "@/lib/isAdmin";
import { PRODUCT_IMAGE_TYPES } from "@/lib/productImage";

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File;

  if (!file) return NextResponse.json({ error: "Ingen fil" }, { status: 400 });

  // Only what /api/img will serve back — anything else would upload fine and then
  // never display. No SVG: it can carry script.
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!PRODUCT_IMAGE_TYPES[ext]) {
    return NextResponse.json(
      { error: `Kun billeder (${Object.keys(PRODUCT_IMAGE_TYPES).join(", ")})` },
      { status: 400 }
    );
  }
  const filename = `products/${Date.now()}.${ext}`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      // Store as private (the store is configured with private access).
      // Return a proxy URL that the browser can load via /api/img.
      await put(filename, file, {
        access: "private",
        contentType: PRODUCT_IMAGE_TYPES[ext],
        allowOverwrite: true,
      });
      const proxyUrl = `/api/img?p=${encodeURIComponent(filename)}`;
      return NextResponse.json({ url: proxyUrl });
    } catch (err) {
      console.error("Blob upload error:", err);
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Upload fejlede" },
        { status: 500 }
      );
    }
  } else {
    // Local filesystem (development)
    const buffer = Buffer.from(await file.arrayBuffer());
    const savePath = path.join(process.cwd(), "public", filename);
    fs.mkdirSync(path.dirname(savePath), { recursive: true });
    fs.writeFileSync(savePath, buffer);
    return NextResponse.json({ url: `/${filename}` });
  }
}
