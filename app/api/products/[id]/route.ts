import { NextRequest, NextResponse } from "next/server";
import { Product } from "@/lib/products";
import { isAdmin } from "@/lib/isAdmin";
import { readJsonFile, writeJsonFile } from "@/lib/storage";
import { deriveColorSetup } from "@/lib/productModel";

async function readProducts(): Promise<Product[]> {
  return readJsonFile<Product[]>("products.json", []);
}

async function writeProducts(products: Product[]): Promise<void> {
  await writeJsonFile("products.json", products);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });

  const { id } = await params;
  const products = await readProducts();
  const updated = products.filter((p) => p.id !== id);

  if (updated.length === products.length) {
    return NextResponse.json({ error: "Produkt ikke fundet" }, { status: 404 });
  }

  await writeProducts(updated);
  return NextResponse.json({ ok: true });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const products = await readProducts();

  const idx = products.findIndex((p) => p.id === id);
  if (idx === -1) return NextResponse.json({ error: "Produkt ikke fundet" }, { status: 404 });

  const images: string[] = body.images && body.images.length > 0
    ? body.images
    : body.image ? [body.image] : (products[idx].images ?? []);

  // If a new model file is uploaded, reset the Bambuddy sync state so the
  // sidecar re-uploads it and re-fetches stats for the new file.
  const prev = products[idx];
  const newModelFile = body.modelFile !== undefined ? body.modelFile : prev.modelFile;
  const modelChanged = body.modelFile !== undefined && body.modelFile !== prev.modelFile;

  products[idx] = {
    ...prev,
    name: body.name,
    description: body.description,
    price: Math.round(parseFloat(body.price) * 100),
    image: images[0] || prev.image,
    images,
    emoji: body.emoji || prev.emoji,
    category: body.category,
    material: body.material ?? prev.material ?? "",
    modelUrl: body.modelUrl ?? prev.modelUrl ?? "",
    colorSlots: body.colorSlots ?? prev.colorSlots ?? [],
    printMinutes: body.printMinutes ? Number(body.printMinutes) : prev.printMinutes,
    filamentGrams: body.filamentGrams ? Number(body.filamentGrams) : prev.filamentGrams,
    materialCost: body.materialCost ? Math.round(parseFloat(body.materialCost) * 100) : prev.materialCost,
    modelFile: newModelFile,
    // Optional posed/light preview model for the shop's 3D view ("" clears it).
    previewModel: body.previewModel !== undefined ? (body.previewModel || undefined) : prev.previewModel,
    // colorZones may be sent on save; a new model file invalidates them.
    ...(Array.isArray(body.colorZones) ? { colorZones: body.colorZones } : {}),
    // A new model file invalidates the Bambuddy sync state, the derived
    // production stats AND the colour-zone mapping (zones can change), so they
    // get re-derived/re-mapped from the new file.
    ...(modelChanged
      ? {
          modelSyncedAt: undefined,
          bambuddyId: undefined,
          bambuddyStatsAt: undefined,
          printMinutes: undefined,
          filamentGrams: undefined,
          materialCost: undefined,
          colorZones: undefined,
        }
      : {}),
  };

  // Auto-create colour zones/slots from the model when missing (e.g. right after
  // a new model upload), so the admin gets one slot per zone with the model's
  // colours — no manual setup needed.
  const p = products[idx];
  if (p.modelFile && (modelChanged || !p.colorZones || (p.colorSlots?.length ?? 0) === 0)) {
    const derived = await deriveColorSetup(p.modelFile);
    if (derived) {
      if (modelChanged || (p.colorSlots?.length ?? 0) === 0) p.colorSlots = derived.colorSlots;
      if (modelChanged || !p.colorZones) p.colorZones = derived.colorZones;
    }
  }

  await writeProducts(products);
  return NextResponse.json(products[idx]);
}
