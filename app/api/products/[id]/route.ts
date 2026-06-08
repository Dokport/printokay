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
  products[idx] = {
    ...products[idx],
    name: body.name,
    description: body.description,
    price: Math.round(parseFloat(body.price) * 100),
    image: images[0] || products[idx].image,
    images,
    emoji: body.emoji || products[idx].emoji,
    category: body.category,
    material: body.material ?? products[idx].material ?? "",
    modelUrl: body.modelUrl ?? products[idx].modelUrl ?? "",
    colorSlots: body.colorSlots ?? products[idx].colorSlots ?? [],
    printMinutes: body.printMinutes ? Number(body.printMinutes) : products[idx].printMinutes,
    filamentGrams: body.filamentGrams ? Number(body.filamentGrams) : products[idx].filamentGrams,
    materialCost: body.materialCost ? Math.round(parseFloat(body.materialCost) * 100) : products[idx].materialCost,
  };

  await writeProducts(products);
  return NextResponse.json(products[idx]);
}
