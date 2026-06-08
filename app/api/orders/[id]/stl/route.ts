/**
 * Admin-only endpoint: download the STL for a specific keyring line item.
 *
 * The `id` path segment is the item's stlId (order id + item index, or the
 * order id itself for legacy single-keyring orders).
 *
 * 2-color printing: in BambuStudio add a filament change at Z = 2.4mm.
 */
import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/isAdmin";
import { readOrders, readStl } from "@/lib/orders";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }

  const { id: stlId } = await params;

  const stl = await readStl(stlId);
  if (!stl) {
    return NextResponse.json(
      { error: "STL-fil ikke fundet" },
      { status: 404 }
    );
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
  const filename = `${stlId}_${safeText}.stl`;

  return new NextResponse(new Uint8Array(stl), {
    headers: {
      "Content-Type": "model/stl",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
