import { NextRequest, NextResponse } from "next/server";
import { Product } from "@/lib/products";
import { isAdmin } from "@/lib/isAdmin";
import { readJsonFile, writeJsonFile } from "@/lib/storage";

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
  };

  products.push(newProduct);
  await writeProducts(products);

  return NextResponse.json(newProduct, { status: 201 });
}
