/**
 * Admin-only endpoint: download the STL for a specific order.
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

  const { id } = await params;

  const orders = await readOrders();
  const order = orders.find((o) => o.id === id);
  if (!order) {
    return NextResponse.json({ error: "Ordre ikke fundet" }, { status: 404 });
  }

  const stl = await readStl(id);
  if (!stl) {
    return NextResponse.json(
      { error: "STL-fil ikke fundet for denne ordre" },
      { status: 404 }
    );
  }

  const safeText = (order.config.text ?? "noglering")
    .replace(/[^a-zA-Z0-9æøåÆØÅ]/g, "_")
    .slice(0, 20);
  const filename = `${id}_${safeText}.stl`;

  return new NextResponse(new Uint8Array(stl), {
    headers: {
      "Content-Type": "model/stl",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
