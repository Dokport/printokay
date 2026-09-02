/**
 * Promokoder: én kode, én gratis nøglering, én gang.
 *
 * A code is generated in admin, handed to a specific customer (by email or
 * copy/paste), and dies the moment it is redeemed. That single-use rule is the
 * whole security model — a code that leaks can cost at most one keyring.
 *
 * The discount is ALWAYS recomputed here from the server's own view of the cart.
 * Nothing the browser sends about the discount is trusted; the client's copy only
 * decides what the cart displays.
 */
import { readJsonFile, writeJsonFile } from "./storage";
import type { CartItem } from "./cart";
import { loadPricing, type Pricing } from "./pricing";

const PROMOS_FILE = "promos.json";

/**
 * How long a checkout may hold a code before it returns to the pool. The holder is
 * the customer's browser, not the Stripe session, so going back from the payment
 * page and trying again re-acquires the same reservation instead of locking them
 * out of their own code. The TTL only matters for OTHER people.
 */
const RESERVATION_TTL_MS = 60 * 60 * 1000;

/** No 0/O or 1/I/L — these get read aloud and typed by hand. */
const ALPHABET = "ACDEFGHJKMNPQRTUVWXY34679";

export type PromoCode = {
  code: string;              // canonical form, e.g. "PO7K4MQX9A"
  createdAt: string;
  reward: "free-keyring";    // the only reward so far; named so more can follow
  note?: string;             // admin's own reminder ("reklamation, Mette")
  sentTo?: string;           // email it was mailed to, if any
  sentAt?: string;
  expiresAt?: string;
  reservedBy?: string;       // browser holding it through checkout
  reservedAt?: string;
  redeemedAt?: string;
  redeemedOrderId?: string;
  redeemedEmail?: string;
};

export type PromoStatus = "active" | "reserved" | "redeemed" | "expired";

/** Strip formatting so "po-7k4m qx9a" and "PO7K4MQX9A" are the same code. */
export function normalizePromoCode(raw: string): string {
  return (raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Grouped for reading aloud and retyping: PO7K-4MQX-9A. */
export function formatPromoCode(code: string): string {
  return code.replace(/(.{4})/g, "$1-").replace(/-$/, "");
}

export function generatePromoCode(): string {
  const bytes = new Uint8Array(10);
  globalThis.crypto.getRandomValues(bytes);
  return "PO" + Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export async function readPromos(): Promise<PromoCode[]> {
  const list = await readJsonFile<PromoCode[]>(PROMOS_FILE, []);
  return Array.isArray(list) ? list : [];
}

async function writePromos(list: PromoCode[]): Promise<void> {
  await writeJsonFile(PROMOS_FILE, list);
}

export function promoStatus(p: PromoCode, now = Date.now()): PromoStatus {
  if (p.redeemedAt) return "redeemed";
  if (p.expiresAt && Date.parse(p.expiresAt) < now) return "expired";
  if (p.reservedAt && now - Date.parse(p.reservedAt) < RESERVATION_TTL_MS) return "reserved";
  return "active";
}

/**
 * What a code is worth against this cart: ONE unit of the priciest keyring in it,
 * priced from the shop's own settings rather than from the cart. Ordering three of
 * the same keyring still discounts exactly one; raising a price in admin raises
 * what the code is worth, with nothing to change here.
 *
 * Returns null when the cart has no keyring — the code stays untouched, so the
 * customer can come back with one.
 */
export function keyringDiscountFor(
  items: CartItem[],
  pricing: Pricing
): { cartKey: string; amount: number } | null {
  let best: { cartKey: string; amount: number } | null = null;
  for (const item of items) {
    if (!item.keyringData) continue;
    const amount = pricing.priceOf(item);
    if (amount === null) continue;
    if (!best || amount > best.amount) best = { cartKey: item.cartKey, amount };
  }
  return best && best.amount > 0 ? best : null;
}

export type PromoCheck =
  | { ok: true; promo: PromoCode; discount: number; cartKey: string }
  | { ok: false; error: string };

/**
 * Validate a code against a cart without changing anything. `holderId` identifies
 * the browser asking, so it can re-check a code it already reserved without
 * tripping over its own reservation.
 */
export async function checkPromo(
  raw: string,
  items: CartItem[],
  holderId?: string,
  pricing?: Pricing
): Promise<PromoCheck> {
  const code = normalizePromoCode(raw);
  if (!code) return { ok: false, error: "Skriv en promokode." };

  const promo = (await readPromos()).find((p) => p.code === code);
  // Deliberately the same message for unknown and used-up codes: a probe should
  // not be able to tell "this code existed" from "this code never existed".
  if (!promo) return { ok: false, error: "Ugyldig promokode." };

  const status = promoStatus(promo);
  if (status === "redeemed") return { ok: false, error: "Denne promokode er allerede brugt." };
  if (status === "expired") return { ok: false, error: "Denne promokode er udløbet." };
  if (status === "reserved" && promo.reservedBy !== holderId) {
    return { ok: false, error: "Promokoden er i brug lige nu. Prøv igen om lidt." };
  }

  const target = keyringDiscountFor(items, pricing ?? (await loadPricing()));
  if (!target) {
    return { ok: false, error: "Koden giver en gratis nøglering — læg en nøglering i kurven først." };
  }

  return { ok: true, promo, discount: target.amount, cartKey: target.cartKey };
}

/**
 * Take the code out of circulation for this checkout. Re-reads and re-checks
 * immediately before writing, so two checkouts racing for the last use of a code
 * cannot both win.
 */
export async function reservePromo(raw: string, holderId: string): Promise<boolean> {
  const code = normalizePromoCode(raw);
  const list = await readPromos();
  const promo = list.find((p) => p.code === code);
  if (!promo) return false;

  const status = promoStatus(promo);
  if (status === "redeemed" || status === "expired") return false;
  if (status === "reserved" && promo.reservedBy !== holderId) return false;

  promo.reservedBy = holderId;
  promo.reservedAt = new Date().toISOString();
  await writePromos(list);
  return true;
}

/** Hand a reservation back, e.g. when building the Stripe session failed. */
export async function releasePromo(raw: string, holderId: string): Promise<void> {
  const code = normalizePromoCode(raw);
  const list = await readPromos();
  const promo = list.find((p) => p.code === code);
  if (!promo || promo.reservedBy !== holderId || promo.redeemedAt) return;
  delete promo.reservedBy;
  delete promo.reservedAt;
  await writePromos(list);
}

/**
 * Burn the code against a finished order. Idempotent, because order creation can
 * be reached twice (webhook and success page) — the second call sees redeemedAt
 * and leaves the first redemption's details alone.
 */
export async function redeemPromo(
  raw: string,
  orderId: string,
  email?: string
): Promise<PromoCode | null> {
  const code = normalizePromoCode(raw);
  const list = await readPromos();
  const promo = list.find((p) => p.code === code);
  if (!promo) return null;
  if (promo.redeemedAt) return promo;

  promo.redeemedAt = new Date().toISOString();
  promo.redeemedOrderId = orderId;
  if (email) promo.redeemedEmail = email;
  delete promo.reservedBy;
  delete promo.reservedAt;
  await writePromos(list);
  return promo;
}

export async function createPromos(
  count: number,
  fields: { note?: string; expiresAt?: string } = {}
): Promise<PromoCode[]> {
  const list = await readPromos();
  const existing = new Set(list.map((p) => p.code));
  const made: PromoCode[] = [];

  for (let i = 0; i < Math.max(1, Math.min(count, 100)); i++) {
    let code = generatePromoCode();
    while (existing.has(code)) code = generatePromoCode();
    existing.add(code);
    made.push({
      code,
      createdAt: new Date().toISOString(),
      reward: "free-keyring",
      ...(fields.note ? { note: fields.note } : {}),
      ...(fields.expiresAt ? { expiresAt: fields.expiresAt } : {}),
    });
  }

  await writePromos([...made, ...list]);
  return made;
}

export async function markPromoSent(code: string, email: string): Promise<void> {
  const list = await readPromos();
  const promo = list.find((p) => p.code === normalizePromoCode(code));
  if (!promo) return;
  promo.sentTo = email;
  promo.sentAt = new Date().toISOString();
  await writePromos(list);
}

/** Only unused codes can be deleted — a redeemed one is a receipt. */
export async function deletePromo(code: string): Promise<boolean> {
  const wanted = normalizePromoCode(code);
  const list = await readPromos();
  const promo = list.find((p) => p.code === wanted);
  if (!promo || promo.redeemedAt) return false;
  await writePromos(list.filter((p) => p.code !== wanted));
  return true;
}
