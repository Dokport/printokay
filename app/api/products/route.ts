import { NextRequest, NextResponse } from "next/server";
import { Product } from "@/lib/products";
import { isAdmin } from "@/lib/isAdmin";
import { readJsonFile, writeJsonFile } from "@/lib/storage";
import { analyzeModel, meshCacheKey } from "@/lib/productModel";
import { mutateProducts } from "@/lib/productStore";
import { publicProduct } from "@/lib/publicData";

async function readProducts(): Promise<Product[]> {
  return readJsonFile<Product[]>("products.json", []);
}


// Admin edits these records and gets them whole; the shop gets publicProduct —
// no costs, print times or storage paths.
export async function GET(req: NextRequest) {
  const products = await readProducts();
  return NextResponse.json(isAdmin(req) ? products : products.map(publicProduct));
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });

  const body = await req.json();

  const images: string[] = body.images && body.images.length > 0
    ? body.images
    : body.image ? [body.image] : [];
  const newProduct: Product = {
    id: body.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") + "-" + Date.now(),
    name: body.name,
    description: body.description,
    price: Math.round(parseFloat(body.price) * 100),
    image: images[0] || "/products/placeholder.jpg",
    images,
    emoji: body.emoji || "🖨️",
    category: body.category,
    material: body.material || "",
    modelUrl: body.modelUrl || "",
    colorSlots: body.colorSlots ?? [],
    ...(body.printMinutes ? { printMinutes: Number(body.printMinutes) } : {}),
    ...(body.filamentGrams ? { filamentGrams: Number(body.filamentGrams) } : {}),
    ...(body.materialCost ? { materialCost: Math.round(parseFloat(body.materialCost) * 100) } : {}),
    ...(body.modelFile ? { modelFile: body.modelFile } : {}),
    ...(body.printFile ? { printFile: body.printFile } : {}),
    ...(body.previewModel ? { previewModel: body.previewModel } : {}),
    ...(Array.isArray(body.colorZones) ? { colorZones: body.colorZones } : {}),
  };

  // Parse the display model once: pre-warm the light mesh cache (so the first
  // customer view is instant) and auto-create colour zones if none were supplied.
  const displayFile = newProduct.previewModel || newProduct.modelFile;
  if (displayFile) {
    const a = await analyzeModel(displayFile);
    if (a) {
      writeJsonFile(meshCacheKey(displayFile), a.mesh).catch(() => {});
      if (newProduct.colorSlots.length === 0) newProduct.colorSlots = a.colorSlots;
      if (!newProduct.colorZones) newProduct.colorZones = a.colorZones;
    }
  }

  // Appended to the CURRENT list: the model analysis above can take seconds, and
  // the sidecar may have saved products in the meantime.
  await mutateProducts((products) => {
    products.push(newProduct);
    return { result: undefined, changed: true };
  });

  return NextResponse.json(newProduct, { status: 201 });
}
