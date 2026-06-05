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
    const blob = await put(filename, file, { access: "public" });
    return NextResponse.json({ url: blob.url });
  } else {
    const buffer = Buffer.from(await file.arrayBuffer());
    const savePath = path.join(process.cwd(), "public", filename);
    fs.mkdirSync(path.dirname(savePath), { recursive: true });
    fs.writeFileSync(savePath, buffer);
    return NextResponse.json({ url: `/${filename}` });
  }
}
