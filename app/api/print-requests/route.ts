/**
 * Send-to-printer queue.
 *
 *  POST (admin)        create a request to print a product's sliced file.
 *                      Body: { productId, printerId?, quantity? }
 *  GET  (sync-token)   open requests for the sidecar, enriched with the Bambuddy
 *                      printFileId to call /library/files/{id}/print.
 *  GET  (admin)        all requests (for status display in admin).
 */
import { NextRequest, NextResponse } from "next/server";
import { Product, PrintRequest } from "@/lib/products";
import { readJsonFile, writeJsonFile } from "@/lib/storage";
import { isAdmin } from "@/lib/isAdmin";
import { isSyncAuthed } from "@/lib/isSyncAuthed";

const FILE = "print-requests.json";

export async function GET(req: NextRequest) {
  // Sidecar: only open requests, with the Bambuddy file id to print.
  if (isSyncAuthed(req)) {
    const [requests, products] = await Promise.all([
      readJsonFile<PrintRequest[]>(FILE, []),
      readJsonFile<Product[]>("products.json", []),
    ]);
    const open = requests
      .filter((r) => r.status === "open")
      .map((r) => {
        const p = products.find((x) => x.id === r.productId);
        return {
          id: r.id,
          productId: r.productId,
          printerId: r.printerId,
          quantity: r.quantity,
          printFileId: p?.bambuddy?.printFileId,
          projectId: p?.bambuddy?.projectId,
        };
      })
      .filter((r) => r.printFileId); // can't print without an uploaded sliced file
    return NextResponse.json({ requests: open });
  }

  if (isAdmin(req)) {
    return NextResponse.json(await readJsonFile<PrintRequest[]>(FILE, []));
  }

  return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });

  const { productId, printerId, quantity } = await req.json();
  if (!productId) {
    return NextResponse.json({ error: "productId påkrævet" }, { status: 400 });
  }

  const products = await readJsonFile<Product[]>("products.json", []);
  const product = products.find((p) => p.id === productId);
  if (!product) {
    return NextResponse.json({ error: "Produkt ikke fundet" }, { status: 404 });
  }
  if (!product.bambuddy?.printFileId) {
    return NextResponse.json(
      { error: "Produktet har ingen sliced fil i Bambuddy endnu" },
      { status: 409 }
    );
  }

  const requests = await readJsonFile<PrintRequest[]>(FILE, []);
  const request: PrintRequest = {
    id: `pr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    productId,
    productName: product.name,
    ...(printerId ? { printerId: String(printerId) } : {}),
    quantity: Math.max(1, Math.round(Number(quantity) || 1)),
    status: "open",
    createdAt: new Date().toISOString(),
  };
  requests.unshift(request);
  await writeJsonFile(FILE, requests);

  return NextResponse.json(request, { status: 201 });
}
