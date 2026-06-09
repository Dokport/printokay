/**
 * Auto product setup: accept a Bambu Studio project .3mf, store it, and extract
 * everything the shop can pre-fill — name, description, material, colour zones
 * (with the model's colours) and a thumbnail image. The admin then only sets
 * price + category and saves.
 */
import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import fs from "fs";
import path from "path";
import { isAdmin } from "@/lib/isAdmin";
import { writeBinaryFile } from "@/lib/storage";
import { parseThreeMf, parseThreeMfMeta } from "@/lib/threemf";
import type { ColorSlot, ColorZone } from "@/lib/products";

// Save an image (Buffer) and return a browser-loadable URL, mirroring /api/upload.
async function saveImage(buf: Buffer, ext: string): Promise<string> {
  const filename = `products/${Date.now()}.${ext}`;
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    await put(filename, buf, { access: "private", allowOverwrite: true });
    return `/api/img?p=${encodeURIComponent(filename)}`;
  }
  const savePath = path.join(process.cwd(), "public", filename);
  fs.mkdirSync(path.dirname(savePath), { recursive: true });
  fs.writeFileSync(savePath, buf);
  return `/${filename}`;
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Ingen fil" }, { status: 400 });

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!["3mf", "stl"].includes(ext)) {
    return NextResponse.json({ error: "Kun .3mf og .stl" }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  // Store the model file (kept intact for Bambuddy sync + 3D viewer).
  const modelFile = `models/${Date.now()}.${ext}`;
  await writeBinaryFile(modelFile, Buffer.from(bytes));

  // Parse geometry zones + project metadata.
  let zones, meta;
  try {
    ({ zones } = parseThreeMf(bytes));
    meta = parseThreeMfMeta(bytes);
  } catch (err) {
    console.error("parse-model error:", err);
    return NextResponse.json({ error: "Kunne ikke læse modellen" }, { status: 422 });
  }

  const colorSlots: ColorSlot[] = zones.map((_, i) => ({ id: `slot-${i + 1}`, label: `Farve ${i + 1}` }));
  const colorZones: ColorZone[] = zones.map((z, i) => ({ key: z.key, slotId: `slot-${i + 1}`, color: z.color }));

  let image = "";
  if (meta.thumbnail && meta.thumbnail.length) {
    try { image = await saveImage(Buffer.from(meta.thumbnail), "png"); } catch { /* optional */ }
  }

  return NextResponse.json({
    modelFile,
    name: meta.title ?? file.name.replace(/\.[^.]+$/, ""),
    description: meta.description ?? "",
    material: meta.material ?? "",
    image,
    images: image ? [image] : [],
    colorSlots,
    colorZones,
    zoneCount: zones.length,
  });
}
