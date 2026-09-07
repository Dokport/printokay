/**
 * Admin-only: download a fidget line item's 3MF. The `id` path segment is the
 * item's fileId. Always generated fresh, so the download reflects the current
 * geometry and stem calibration.
 */
import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/isAdmin";
import { readOrders, type OrderItemFidget } from "@/lib/orders";
import { buildFidget3mfFor, fidgetFileName } from "@/lib/fidgetOrder";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }

  const { id: fileId } = await params;
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
        "Content-Disposition": `attachment; filename="${fidgetFileName(fidget)}"`,
      },
    });
  } catch (err) {
    console.error(`3MF generation failed for fidget ${fileId}:`, err);
    return NextResponse.json({ error: "Kunne ikke generere 3MF" }, { status: 500 });
  }
}
