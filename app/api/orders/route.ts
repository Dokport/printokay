import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { isAdmin } from "@/lib/isAdmin";
import { readOrders, createOrder, updateOrderStatus, saveStl, markStlGenerated } from "@/lib/orders";
import { generateKeyringStl } from "@/lib/stl";
import { DEFAULT_KEYRING_SETTINGS } from "@/lib/keyring";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { readJsonFile } from "@/lib/storage";
import type { SiteSettings } from "@/lib/settings";

// POST — Create order after successful Stripe payment
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { sessionId, keyringConfig, baseColorHex, textColorHex, baseFilamentName, textFilamentName, sizeId, pricePaid } = body;

    if (!sessionId) {
      return NextResponse.json({ error: "sessionId påkrævet" }, { status: 400 });
    }

    // Verify Stripe session is paid
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    let session;
    try {
      session = await stripe.checkout.sessions.retrieve(sessionId);
    } catch {
      return NextResponse.json({ error: "Ugyldig Stripe session" }, { status: 400 });
    }

    if (session.payment_status !== "paid") {
      return NextResponse.json({ error: "Betaling ikke bekræftet" }, { status: 402 });
    }

    // Get settings
    const stored = await readJsonFile<Partial<SiteSettings>>("settings.json", {});
    const settings = { ...DEFAULT_SETTINGS, ...stored };
    const keyringSettings = settings.keyring ?? DEFAULT_KEYRING_SETTINGS;
    const size = keyringSettings.sizes.find((s: { id: string }) => s.id === sizeId)
      ?? keyringSettings.sizes[0];

    // Create order record
    const order = await createOrder({
      stripeSessionId: sessionId,
      config: keyringConfig,
      size,
      baseColorHex: baseColorHex ?? "#000000",
      textColorHex: textColorHex ?? "#ffffff",
      baseFilamentName: baseFilamentName ?? "Base",
      textFilamentName: textFilamentName ?? "Tekst",
      pricePaid: pricePaid ?? 0,
    });

    // Generate STL in background
    if (!order.stlGenerated) {
      try {
        const stl = await generateKeyringStl(keyringConfig, size);
        await saveStl(order.id, stl);
        await markStlGenerated(order.id);
      } catch (stlErr) {
        console.error("STL generation failed:", stlErr);
        // Order is still created, STL can be re-generated later
      }
    }

    return NextResponse.json({ orderId: order.id });
  } catch (err) {
    console.error("Order creation error:", err);
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
