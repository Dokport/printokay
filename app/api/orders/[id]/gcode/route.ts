import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/isAdmin";
import { readGcode, readOrders } from "@/lib/orders";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }

  const { id } = await params;
  const gcode = readGcode(id);

  if (!gcode) {
    return NextResponse.json({ error: "G-code fil ikke fundet" }, { status: 404 });
  }

  // Get order for filename hint
  const orders = readOrders();
  const order = orders.find((o) => o.id === id);
  const text = order?.config?.text ?? "noglering";
  const safeText = text.replace(/[^a-zA-Z0-9æøåÆØÅ]/g, "_").slice(0, 20);

  return new NextResponse(gcode, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="noglering_${safeText}_${id}.gcode"`,
    },
  });
}
