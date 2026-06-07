import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { isAdmin } from "@/lib/isAdmin";
import { readOrders } from "@/lib/orders";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdmin(req)) return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });

  const { id } = await params;
  const orders = await readOrders();
  const order = orders.find((o) => o.id === id);
  if (!order) return NextResponse.json({ error: "Ordre ikke fundet" }, { status: 404 });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  try {
    const session = await stripe.checkout.sessions.retrieve(order.stripeSessionId);

    // Stripe SDK v22: address is in collected_information.shipping_details or customer_details
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = session as any;
    const shipping = raw.collected_information?.shipping_details ?? raw.shipping_details;
    const customer = session.customer_details;

    const addr = shipping?.address ?? customer?.address;
    const name = shipping?.name ?? customer?.name ?? "—";
    const email = customer?.email ?? "—";
    const phone = customer?.phone ?? null;

    const addressStr = addr ? [
      addr.line1,
      addr.line2,
      [addr.postal_code, addr.city].filter(Boolean).join(" "),
      addr.country,
    ].filter(Boolean).join(", ") : "—";

    return NextResponse.json({ name, email, phone, address: addressStr });
  } catch {
    return NextResponse.json({ error: "Kunne ikke hente Stripe-session" }, { status: 500 });
  }
}
