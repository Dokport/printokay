/**
 * Stripe webhook — the reliable, server-to-server path for recording orders.
 *
 * Stripe calls this when a checkout payment succeeds, independently of the
 * customer's browser. On `checkout.session.completed` we finalize the order
 * (idempotent, shared with the success-page fallback).
 *
 * Setup: in the Stripe dashboard add an endpoint pointing at
 *   https://printokay.dk/api/webhooks/stripe
 * subscribed to `checkout.session.completed`, then put its signing secret in
 * the STRIPE_WEBHOOK_SECRET env var.
 */
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { finalizeOrder } from "@/lib/fulfillment";

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    console.error("STRIPE_WEBHOOK_SECRET ikke sat — webhook ignoreret");
    // 200 so Stripe doesn't retry-storm while the secret is being configured.
    return NextResponse.json({ received: true, configured: false });
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ error: "Mangler signatur" }, { status: 400 });

  const body = await req.text(); // raw body required for signature verification
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret);
  } catch (err) {
    console.error("Webhook signaturfejl:", err);
    return NextResponse.json({ error: "Ugyldig signatur" }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    try {
      await finalizeOrder(session.id);
    } catch (err) {
      console.error("Webhook finalize-fejl:", err);
      // 500 → Stripe retries later.
      return NextResponse.json({ error: "Finalize-fejl" }, { status: 500 });
    }
  }

  return NextResponse.json({ received: true });
}
