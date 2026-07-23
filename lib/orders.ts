import type { KeyringConfig, KeyringSizeOption } from "./keyring";
import { readJsonFile, writeJsonFile, readBinaryFile, writeBinaryFile } from "./storage";

// ─── Universal order model ──────────────────────────────────────────────────────
//
// An order can contain ANY mix of product types: regular products (figurer,
// fidgets, gadgets) and custom keyrings. Each line item is self-describing.
// Keyring items carry the extra config needed to (re)generate their STL.

export type OrderItemKeyring = {
  config: KeyringConfig;
  size: KeyringSizeOption;
  baseColorHex: string;
  textColorHex: string;
  baseFilamentName: string;
  textFilamentName: string;
  stlId: string;          // file key: stl/{stlId}.stl (+ stl/{stlId}.3mf)
  stlGenerated: boolean;
  threeMfGenerated?: boolean; // a 2-colour 3MF was also saved (stl/{stlId}.3mf)
  // ── Bambuddy-synkronisering (sat af sidecaren, ligesom produkter) ──
  bambuddyFileId?: string;    // uploaded 3MF's Bambuddy file id
  bambuddyFolderId?: string;
  bambuddySyncedAt?: string;
};

export type OrderColorChoice = {
  slotLabel: string;
  filamentName: string;
  filamentColor: string;
};

export type OrderItem = {
  name: string;
  description?: string;
  emoji?: string;
  quantity: number;
  unitAmount: number;     // øre per unit
  keyring?: OrderItemKeyring;     // present only for keyring items
  colorChoices?: OrderColorChoice[];
  note?: string;
};

export type OrderCustomer = {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
};

export type Order = {
  id: string;
  createdAt: string;
  stripeSessionId: string;
  status: "pending" | "printed";
  total: number;          // øre (incl. shipping if known)
  items: OrderItem[];
  customer?: OrderCustomer;
};

// Back-compat alias — older imports referenced KeyringOrder.
export type KeyringOrder = Order;

// ─── Migration of legacy keyring-only records ───────────────────────────────────

type LegacyKeyringOrder = {
  id: string;
  createdAt: string;
  stripeSessionId: string;
  config: KeyringConfig;
  size: KeyringSizeOption;
  baseColorHex: string;
  textColorHex: string;
  baseFilamentName: string;
  textFilamentName: string;
  pricePaid: number;
  status: "pending" | "printed";
  stlGenerated?: boolean;
  gcodeGenerated?: boolean;
};

function migrateLegacy(o: LegacyKeyringOrder): Order {
  const stlGenerated = Boolean(o.stlGenerated ?? o.gcodeGenerated);
  return {
    id: o.id,
    createdAt: o.createdAt,
    stripeSessionId: o.stripeSessionId,
    status: o.status,
    total: o.pricePaid ?? 0,
    items: [
      {
        name: `Nøglering: "${o.config?.text ?? ""}"`,
        emoji: "🔑",
        quantity: 1,
        unitAmount: o.pricePaid ?? 0,
        keyring: {
          config: o.config,
          size: o.size,
          baseColorHex: o.baseColorHex,
          textColorHex: o.textColorHex,
          baseFilamentName: o.baseFilamentName,
          textFilamentName: o.textFilamentName,
          stlId: o.id,        // legacy STL files are stored at stl/{orderId}.stl
          stlGenerated,
        },
      },
    ],
  };
}

// ─── Orders JSON ──────────────────────────────────────────────────────────────

export async function readOrders(): Promise<Order[]> {
  const raw = await readJsonFile<unknown[]>("orders.json", []);
  return raw.map((o) => {
    const rec = o as Record<string, unknown>;
    // New-style records already have an items array.
    if (Array.isArray(rec.items)) return rec as unknown as Order;
    // Legacy keyring-only record → migrate.
    return migrateLegacy(rec as unknown as LegacyKeyringOrder);
  });
}

export async function writeOrders(orders: Order[]): Promise<void> {
  await writeJsonFile("orders.json", orders);
}

/** Append an order, deduping by Stripe session id (idempotent). */
export async function addOrder(order: Order): Promise<Order> {
  const orders = await readOrders();
  const existing = orders.find((o) => o.stripeSessionId === order.stripeSessionId);
  if (existing) return existing;
  orders.unshift(order);
  await writeOrders(orders);
  return order;
}

export async function findOrderBySession(sessionId: string): Promise<Order | undefined> {
  const orders = await readOrders();
  return orders.find((o) => o.stripeSessionId === sessionId);
}

export async function updateOrderStatus(
  orderId: string,
  status: "pending" | "printed"
): Promise<void> {
  const orders = await readOrders();
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx !== -1) {
    orders[idx].status = status;
    await writeOrders(orders);
  }
}

// ─── STL files ────────────────────────────────────────────────────────────────

export async function saveStl(stlId: string, stl: Buffer): Promise<void> {
  await writeBinaryFile(`stl/${stlId}.stl`, stl);
}

export async function readStl(stlId: string): Promise<Buffer | null> {
  return readBinaryFile(`stl/${stlId}.stl`);
}

// ─── 3MF files (2-colour, filament changes embedded) ────────────────────────────

export async function save3mf(stlId: string, threeMf: Buffer): Promise<void> {
  await writeBinaryFile(`stl/${stlId}.3mf`, threeMf);
}

export async function read3mf(stlId: string): Promise<Buffer | null> {
  return readBinaryFile(`stl/${stlId}.3mf`);
}
