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

export async function GET() {
  return NextResponse.json(await readProducts());
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });

  const body = await req.json();
  const products = await readProducts();

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
    ...(body.previewModel ? { previewModel: body.previewModel } : {}),
    ...(Array.isArray(body.colorZones) ? { colorZones: body.colorZones } : {}),
  };

  // Auto-create colour zones/slots from the model when none were supplied.
  if (newProduct.modelFile && (newProduct.colorSlots.length === 0 || !newProduct.colorZones)) {
    const derived = await deriveColorSetup(newProduct.modelFile);
    if (derived) {
      if (newProduct.colorSlots.length === 0) newProduct.colorSlots = derived.colorSlots;
      if (!newProduct.colorZones) newProduct.colorZones = derived.colorZones;
    }
  }

  products.push(newProduct);
  await writeProducts(products);

  return NextResponse.json(newProduct, { status: 201 });
}
