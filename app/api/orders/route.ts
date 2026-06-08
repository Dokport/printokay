import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/isAdmin";
import { readOrders, updateOrderStatus } from "@/lib/orders";
import { finalizeOrder } from "@/lib/fulfillment";

// POST — Finalize an order from the success page (fallback to the webhook).
// Body: { sessionId }. Idempotent + server-side verified, so it's safe to call
// from the browser: it only records an order if Stripe confirms payment.
export async function POST(req: NextRequest) {
  try {
    const { sessionId } = await req.json();
    if (!sessionId) {
      return NextResponse.json({ error: "sessionId påkrævet" }, { status: 400 });
    }
    const order = await finalizeOrder(sessionId);
    if (!order) {
      return NextResponse.json({ error: "Kunne ikke oprette ordre" }, { status: 202 });
    }
    return NextResponse.json({ orderId: order.id });
  } catch (err) {
    console.error("Order finalize error:", err);
    return NextResponse.json({ error: "Intern fejl" }, { status: 500 });
  }
}

// GET — List all orders (admin only)
export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }
  return NextResponse.json(await readOrders());
}

// PATCH — Update order status (admin only)
export async function PATCH(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }
  const { orderId, status } = await req.json();
  await updateOrderStatus(orderId, status);
  return NextResponse.json({ ok: true });
}
