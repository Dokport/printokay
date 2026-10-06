import { NextRequest, NextResponse } from "next/server";
import { Product } from "@/lib/products";
import { isAdmin } from "@/lib/isAdmin";
import { readJsonFile, writeJsonFile } from "@/lib/storage";
import { mutateProducts } from "@/lib/productStore";

/** Written by the printer sidecar, not the admin form. */
const SIDECAR_KEYS = ["bambuddy", "bambuddyId", "bambuddyStatsAt", "modelSyncedAt", "printStats"] as const;
import { analyzeModel, meshCacheKey } from "@/lib/productModel";

async function readProducts(): Promise<Product[]> {
  return readJsonFile<Product[]>("products.json", []);
}


export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });

  const { id } = await params;
  const found = await mutateProducts((products) => {
    const idx = products.findIndex((p) => p.id === id);
    if (idx === -1) return { result: false, changed: false };
    products.splice(idx, 1);
    return { result: true, changed: true };
  });
  if (!found) return NextResponse.json({ error: "Produkt ikke fundet" }, { status: 404 });
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
  // "mv-…" is the public model version (lib/publicData), not a storage path — saving
  // it would point the product at nothing. Treat it as "unchanged".
  if (typeof body.modelFile === "string" && body.modelFile.startsWith("mv-")) delete body.modelFile;
  if (typeof body.previewModel === "string" && body.previewModel.startsWith("mv-")) delete body.previewModel;
  const newModelFile = body.modelFile !== undefined ? body.modelFile : prev.modelFile;
  const modelChanged = body.modelFile !== undefined && body.modelFile !== prev.modelFile;
  // A new sliced print file means re-slice → re-sync to Bambuddy + new stats.
  const newPrintFile = body.printFile !== undefined ? body.printFile : prev.printFile;
  const printChanged = body.printFile !== undefined && body.printFile !== prev.printFile;

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
    printFile: newPrintFile,
    // Optional posed/light preview model for the shop's 3D view ("" clears it).
    previewModel: body.previewModel !== undefined ? (body.previewModel || undefined) : prev.previewModel,
    // Stats sent on save (instant estimate from the sliced file).
    ...(body.statsSource ? { statsSource: body.statsSource } : {}),
    // colorZones may be sent on save; a new model file invalidates them.
    ...(Array.isArray(body.colorZones) ? { colorZones: body.colorZones } : {}),
    // A new project file invalidates the colour-zone mapping.
    ...(modelChanged ? { colorZones: undefined } : {}),
    // A new sliced file (re-slice) invalidates the Bambuddy sync + derived stats,
    // so the sidecar re-uploads and stats are re-derived from the new file.
    ...(printChanged
      ? {
          bambuddy: undefined,
          modelSyncedAt: undefined,
          bambuddyId: undefined,
          bambuddyStatsAt: undefined,
          printStats: undefined,
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
    const cacheKey = meshCacheKey(displayFile);
    const cached = await readJsonFile<unknown>(cacheKey, null);
    // Parse once when the model changed or its light mesh isn't cached yet.
    if (modelChanged || !cached) {
      const a = await analyzeModel(displayFile);
      if (a) {
        // Pre-warm the light display mesh so the first customer view is instant.
        writeJsonFile(cacheKey, a.mesh).catch(() => {});
        // Self-heal colour zones if they don't match the model.
        const storedKeys = (p.colorZones ?? []).map((z) => z.key).sort().join(",");
        const freshKeys = a.colorZones.map((z) => z.key).sort().join(",");
        const stale =
          modelChanged || !p.colorZones || (p.colorSlots?.length ?? 0) !== a.colorSlots.length || storedKeys !== freshKeys;
        if (stale) {
          const prevSlots = p.colorSlots ?? [];
          p.colorSlots = a.colorSlots.map((s, i) =>
            !modelChanged && prevSlots.length === a.colorSlots.length ? { ...s, label: prevSlots[i].label } : s
          );
          p.colorZones = a.colorZones;
        }
      }
    }
  }

  // Everything above worked on a snapshot, and the model analysis can take seconds
  // while the sidecar keeps saving sync state and print statistics. So the write
  // lays this edit over the CURRENT product: the admin's fields win, but what the
  // sidecar owns comes from the fresh copy — unless a new sliced file was uploaded,
  // which is exactly when that state has to be thrown away.
  const edited = products[idx];
  const saved = await mutateProducts<Product | null>((current) => {
    const i = current.findIndex((x) => x.id === id);
    if (i === -1) return { result: null, changed: false };
    const merged: Product = { ...current[i], ...edited };
    const keepFresh = (key: keyof Product) => {
      if (current[i][key] === undefined) delete merged[key];
      else (merged as Record<string, unknown>)[key] = current[i][key];
    };
    for (const key of SIDECAR_KEYS) {
      if (printChanged) delete merged[key];
      else keepFresh(key);
    }
    // Both the form and the sidecar's statistics write these. Only a value the
    // admin actually filled in wins; otherwise the freshest one stays — saving a
    // new name must not roll back print times the sidecar delivered a second ago.
    if (!body.printMinutes) keepFresh("printMinutes");
    if (!body.filamentGrams) keepFresh("filamentGrams");
    if (!body.materialCost) keepFresh("materialCost");
    if (!body.statsSource) keepFresh("statsSource");
    current[i] = merged;
    return { result: merged, changed: true };
  });
  if (!saved) return NextResponse.json({ error: "Produkt ikke fundet" }, { status: 404 });
  return NextResponse.json(saved);
}
