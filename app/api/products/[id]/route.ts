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

  // Auto-create / self-heal colour zones from the DISPLAY model (preview ?? print).
  // Re-derives when missing, when the model changed, or when the stored zone keys
  // no longer match the model (e.g. after the parser learned per-object colours) —
  // so saving an existing product fixes it. Slot labels are preserved by position.
  const p = products[idx];
  const displayFile = p.previewModel || p.modelFile;
  if (displayFile) {
    const derived = await deriveColorSetup(displayFile);
    if (derived) {
      const storedKeys = (p.colorZones ?? []).map((z) => z.key).sort().join(",");
      const freshKeys = derived.colorZones.map((z) => z.key).sort().join(",");
      const stale =
        modelChanged ||
        !p.colorZones ||
        (p.colorSlots?.length ?? 0) !== derived.colorSlots.length ||
        storedKeys !== freshKeys;
      if (stale) {
        // Keep existing slot labels when the zone count is unchanged.
        const prevSlots = p.colorSlots ?? [];
        p.colorSlots = derived.colorSlots.map((s, i) =>
          !modelChanged && prevSlots.length === derived.colorSlots.length ? { ...s, label: prevSlots[i].label } : s
        );
        p.colorZones = derived.colorZones;
      }
    }
  }

  await writeProducts(products);
  return NextResponse.json(products[idx]);
}
