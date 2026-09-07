/**
 * Serve a fidget's 3MF to the home-server sidecar (sync-token auth). Built on the
 * fly from the order's stored configuration — nothing is cached, so the file always
 * reflects the current geometry and the calibrated stem width.
 */
import { NextRequest, NextResponse } from "next/server";
import { readOrders, type OrderItemFidget } from "@/lib/orders";
import { buildFidget3mfFor } from "@/lib/fidgetOrder";
import { isSyncAuthed } from "@/lib/isSyncAuthed";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  if (!isSyncAuthed(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }

  const { fileId } = await params;
  const orders = await readOrders();
  let fidget: OrderItemFidget | undefined;
  for (const o of orders) {
    const item = o.items.find((it) => it.fidget?.fileId === fileId);
    if (item?.fidget) { fidget = item.fidget; break; }
  }
  if (!fidget) {
    return NextResponse.json({ error: "Fidget ikke fundet" }, { status: 404 });
  }

  try {
    const file = await buildFidget3mfFor(fidget);
    return new NextResponse(new Uint8Array(file), {
      headers: {
        "Content-Type": "model/3mf",
        "Content-Disposition": `attachment; filename="${fileId}.3mf"`,
      },
    });
  } catch (err) {
    console.error(`3MF generation failed for fidget ${fileId}:`, err);
    return NextResponse.json({ error: "Kunne ikke generere 3MF" }, { status: 500 });
  }
}
