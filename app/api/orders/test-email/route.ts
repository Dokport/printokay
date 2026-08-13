/**
 * Admin-only test endpoint: send a real order-confirmation email through the
 * exact same code path a live order uses (lib/email.ts → Resend), but built
 * from fake order data — no Stripe session, no order written to storage.
 *
 * POST { to: "you@example.com" }
 */
import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/isAdmin";
import { sendOrderConfirmation } from "@/lib/email";
import type { Order } from "@/lib/orders";

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Ikke tilladt" }, { status: 401 });
  }

  const { to } = await req.json().catch(() => ({}));
  if (!to || typeof to !== "string") {
    return NextResponse.json({ error: "Mangler 'to' (modtager-email)" }, { status: 400 });
  }

  const fakeOrder: Order = {
    id: `test-${Date.now()}`,
    createdAt: new Date().toISOString(),
    stripeSessionId: "test-session",
    status: "pending",
    total: 15800,
    items: [
      {
        name: 'Nøglering: "Emma" (Mellem)',
        description: "Font: Roboto Bold",
        emoji: "🔑",
        quantity: 1,
        unitAmount: 7900,
        keyring: {
          config: {
            text: "Emma", font: "Roboto-Bold", shapeType: "auto", holePosition: "top",
            sizeId: "medium", baseFilamentId: "a", textFilamentId: "b", fontSize: 20,
          },
          size: { id: "medium", label: "Mellem", textHeightMm: 14, widthMm: 60, heightMm: 28, basePrice: 7900 },
          baseColorHex: "#000000", textColorHex: "#ffffff",
          baseFilamentName: "Sort Mat", textFilamentName: "Hvid Mat",
          stlId: "test-0", stlGenerated: true,
        },
      },
      {
        name: "Panda Hjerte Nøglering",
        description: "Sød panda-figur",
        emoji: "🐼",
        quantity: 2,
        unitAmount: 3900,
        colorChoices: [{ slotLabel: "Krop", filamentName: "Galaxy Black", filamentColor: "#1a1a2e" }],
      },
    ],
    customer: {
      name: "Test Testesen",
      email: to,
      address: "Hovedgaden 12, 2. th, 8000 Aarhus C, DK",
    },
  };

  try {
    await sendOrderConfirmation(fakeOrder);
    return NextResponse.json({ ok: true, sentTo: to });
  } catch (err) {
    console.error("Test email error:", err);
    return NextResponse.json({ error: "Afsendelse fejlede", details: String(err) }, { status: 500 });
  }
}
