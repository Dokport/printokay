/**
 * Order fulfillment — the single source of truth for turning a paid Stripe
 * checkout session into a recorded order.
 *
 * Called from two places, both idempotent (dedup by Stripe session id):
 *   1. The Stripe webhook (`checkout.session.completed`) — server-to-server,
 *      fires even if the customer closes their browser. The reliable path.
 *   2. The success-page fallback (`/api/orders/finalize`) — runs immediately
 *      when the customer lands back on the site, so orders appear instantly
 *      even before the webhook is configured.
 *
 * The full cart is stashed server-side at `pending/{sessionId}.json` during
 * checkout, so we never depend on the browser to supply order contents.
 */

import Stripe from "stripe";
import type { CartItem } from "./cart";
import { DEFAULT_KEYRING_SETTINGS } from "./keyring";
import type { KeyringConfig } from "./keyring";
import type { SiteSettings } from "./settings";
import { readJsonFile, deleteFile } from "./storage";
import {
  addOrder,
  findOrderBySession,
  saveStl,
  type Order,
  type OrderItem,
  type OrderCustomer,
} from "./orders";
import { generateKeyringStl } from "./stl";
import { sendOrderConfirmation } from "./email";
import { redeemPromo } from "./promos";
import { loadPricing } from "./pricing";

export type PendingCart = {
  items: CartItem[];
  createdAt: string;
  /** Promo code reserved for this checkout, redeemed when the order is created. */
  promo?: { code: string; discount: number };
};

export function pendingCartKey(sessionId: string): string {
  return `pending/${sessionId}.json`;
}

/** Pull customer name / email / phone / shipping address off a Stripe session. */
function extractCustomer(session: Stripe.Checkout.Session): OrderCustomer {
  // SDK v22: shipping lives under collected_information.shipping_details;
  // older sessions expose it as shipping_details. Fall back to billing details.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = session as any;
  const shipping = raw.collected_information?.shipping_details ?? raw.shipping_details;
  const customer = session.customer_details;

  const addr = shipping?.address ?? customer?.address;
  const addressStr = addr
    ? [
        addr.line1,
        addr.line2,
        [addr.postal_code, addr.city].filter(Boolean).join(" "),
        addr.country,
      ]
        .filter(Boolean)
        .join(", ")
    : undefined;

  return {
    name: shipping?.name ?? customer?.name ?? undefined,
    email: customer?.email ?? undefined,
    phone: customer?.phone ?? undefined,
    address: addressStr,
  };
}

/** Build an order line item from a cart item, generating STL for keyrings. */
async function buildOrderItem(
  ci: CartItem,
  orderId: string,
  idx: number,
  settings: SiteSettings,
  unitAmount: number
): Promise<OrderItem> {

  if (ci.keyringData) {
    const kd = ci.keyringData;
    const keyringSettings = settings.keyring ?? DEFAULT_KEYRING_SETTINGS;
    const size =
      keyringSettings.sizes.find((s) => s.id === kd.sizeId) ?? keyringSettings.sizes[0];

    const config: KeyringConfig = {
      text: kd.text,
      font: kd.font,
      shapeType: kd.shapeType as KeyringConfig["shapeType"],
      holePosition: kd.holePosition ?? "top",
      sizeId: kd.sizeId,
      baseFilamentId: kd.baseFilamentId,
      textFilamentId: kd.textFilamentId,
      fontSize: kd.fontSize,
    };

    const stlId = `${orderId}-${idx}`;
    let stlGenerated = false;
    try {
      const stl = await generateKeyringStl(config, size);
      await saveStl(stlId, stl);
      stlGenerated = true;
    } catch (err) {
      console.error(`STL generation failed for ${stlId}:`, err);
    }
    // The 2-colour 3MF is generated on demand (admin download / Bambuddy sync), so
    // it always reflects the current format — nothing to pre-generate here.

    return {
      name: `Nøglering: "${kd.text}" (${kd.sizeLabel})`,
      description: `Font: ${kd.font.replace(/-/g, " ")}`,
      emoji: "🔑",
      quantity: ci.quantity,
      unitAmount,
      keyring: {
        config,
        size,
        baseColorHex: kd.baseColorHex,
        textColorHex: kd.textColorHex,
        baseFilamentName: kd.baseFilamentName,
        textFilamentName: kd.textFilamentName,
        stlId,
        stlGenerated,
      },
    };
  }

  // Regular product
  return {
    name: ci.product.name,
    description: ci.product.description,
    emoji: ci.product.emoji,
    quantity: ci.quantity,
    unitAmount,
    colorChoices: (ci.colorChoices ?? []).map((c) => ({
      slotLabel: c.slotLabel,
      filamentName: c.filamentName,
      filamentColor: c.filamentColor,
    })),
    note: ci.note,
  };
}

/**
 * Turn a paid Stripe session into an order. Idempotent: returns the existing
 * order if one already exists for this session, and a no-op (null) if the
 * session isn't paid or there's no stashed cart to build from.
 */
export async function finalizeOrder(sessionId: string): Promise<Order | null> {
  // Idempotency — never create a second order for the same session.
  const existing = await findOrderBySession(sessionId);
  if (existing) return existing;

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  let session: Stripe.Checkout.Session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId);
  } catch {
    return null;
  }
  // A fully discounted order (free keyring + free pickup) settles at 0 kr, and
  // Stripe marks those "no_payment_required" rather than "paid" — treating that as
  // unpaid would silently drop the order.
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
    return null;
  }

  const cart = await readJsonFile<PendingCart | null>(pendingCartKey(sessionId), null);
  if (!cart || !Array.isArray(cart.items) || cart.items.length === 0) return null;

  const pricing = await loadPricing();
  const settings = pricing.settings;

  const orderId = `order-${Date.now()}`;
  const items: OrderItem[] = [];
  for (let i = 0; i < cart.items.length; i++) {
    // Price from the shop, not from the stashed cart — the same rule checkout used.
    items.push(
      await buildOrderItem(
        cart.items[i], orderId, i, settings,
        pricing.priceOf(cart.items[i]) ?? 0
      )
    );
  }

  const computedTotal = items.reduce((sum, it) => sum + it.unitAmount * it.quantity, 0);

  const order: Order = {
    id: orderId,
    createdAt: new Date().toISOString(),
    stripeSessionId: sessionId,
    status: "pending",
    total: session.amount_total ?? computedTotal,
    items,
    customer: extractCustomer(session),
    ...(cart.promo ? { promo: cart.promo } : {}),
  };

  const saved = await addOrder(order);

  // Burn the code only now, once the order really exists. redeemPromo is
  // idempotent, and the `existing` guard above means we get here once per order.
  if (cart.promo) {
    try {
      await redeemPromo(cart.promo.code, saved.id, saved.customer?.email);
    } catch (err) {
      console.error(`Kunne ikke indløse promokode ${cart.promo.code} for ${saved.id}:`, err);
    }
  }
  // Clean up the stashed cart (best-effort).
  await deleteFile(pendingCartKey(sessionId));

  // Fire-and-forget: this is the first (and only) time this order is created —
  // the `existing` check above makes every later call for this session a no-op
  // before it ever reaches here, so the confirmation email is sent exactly once,
  // regardless of whether the webhook or the success-page fallback got here first.
  sendOrderConfirmation(saved).catch((err) => console.error("sendOrderConfirmation:", err));

  return saved;
}
