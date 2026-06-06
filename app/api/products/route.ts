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

export async function GET() {
  return NextResponse.json(readProducts());
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });

  const body = await req.json();
  const products = readProducts();

  const newProduct: Product = {
    id: body.name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") + "-" + Date.now(),
    name: body.name,
    description: body.description,
    price: Math.round(parseFloat(body.price) * 100),
    image: body.image || "/products/placeholder.jpg",
    emoji: body.emoji || "🖨️",
    category: body.category,
    material: body.material || "",
    modelUrl: body.modelUrl || "",
    colorSlots: body.colorSlots ?? [],
  };

  products.push(newProduct);
  writeProducts(products);

  return NextResponse.json(newProduct, { status: 201 });
}
