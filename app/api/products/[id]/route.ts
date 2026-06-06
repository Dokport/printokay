import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { Product } from "@/lib/products";
import { isAdmin } from "@/lib/isAdmin";

const DATA_PATH = path.join(process.cwd(), "data", "products.json");

function readProducts(): Product[] {
  return JSON.parse(fs.readFileSync(DATA_PATH, "utf-8"));
}

function writeProducts(products: Product[]) {
  fs.writeFileSync(DATA_PATH, JSON.stringify(products, null, 2));
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });

  const { id } = await params;
  const products = readProducts();
  const updated = products.filter((p) => p.id !== id);

  if (updated.length === products.length) {
    return NextResponse.json({ error: "Produkt ikke fundet" }, { status: 404 });
  }

  writeProducts(updated);
  return NextResponse.json({ ok: true });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const products = readProducts();

  const idx = products.findIndex((p) => p.id === id);
  if (idx === -1) return NextResponse.json({ error: "Produkt ikke fundet" }, { status: 404 });

  products[idx] = {
    ...products[idx],
    name: body.name,
    description: body.description,
    price: Math.round(parseFloat(body.price) * 100),
    image: body.image || products[idx].image,
    emoji: body.emoji || products[idx].emoji,
    category: body.category,
    material: body.material ?? products[idx].material ?? "",
    modelUrl: body.modelUrl ?? products[idx].modelUrl ?? "",
    colorSlots: body.colorSlots ?? products[idx].colorSlots ?? [],
  };

  writeProducts(products);
  return NextResponse.json(products[idx]);
}
