/**
 * Admin-only endpoint: download the 2-colour 3MF for a keyring line item.
 *
 * The `id` path segment is the item's stlId. Unlike the STL, this 3MF has the two
 * filament colours + the filament change embedded, so BambuStudio slices it in two
 * colours with no manual filament change.
 */
import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/isAdmin";
import { readOrders, read3mf } from "@/lib/orders";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }

  const { id: stlId } = await params;

  const file = await read3mf(stlId);
  if (!file) {
    return NextResponse.json({ error: "3MF-fil ikke fundet" }, { status: 404 });
  }

  // Best-effort: find the keyring text for a friendly filename.
  const orders = await readOrders();
  let text = "noglering";
  for (const o of orders) {
    const item = o.items.find((it) => it.keyring?.stlId === stlId);
    if (item?.keyring) {
      text = item.keyring.config.text ?? text;
      break;
    }
  }
  const safeText = text.replace(/[^a-zA-Z0-9æøåÆØÅ]/g, "_").slice(0, 20);
  const filename = `${stlId}_${safeText}.3mf`;

  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "model/3mf",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
