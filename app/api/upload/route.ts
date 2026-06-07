import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import fs from "fs";
import path from "path";
import { isAdmin } from "@/lib/isAdmin";

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File;

  if (!file) return NextResponse.json({ error: "Ingen fil" }, { status: 400 });

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const filename = `products/${Date.now()}.${ext}`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      // Store as private (the store is configured with private access).
      // Return a proxy URL that the browser can load via /api/img.
      await put(filename, file, {
        access: "private",
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
