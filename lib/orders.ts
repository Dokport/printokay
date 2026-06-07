import type { KeyringConfig, KeyringSizeOption } from "./keyring";
import { readJsonFile, writeJsonFile, readBinaryFile, writeBinaryFile } from "./storage";

export type KeyringOrder = {
  id: string;
  createdAt: string;
  stripeSessionId: string;
  config: KeyringConfig;
  size: KeyringSizeOption;
  baseColorHex: string;
  textColorHex: string;
  baseFilamentName: string;
  textFilamentName: string;
  pricePaid: number;  // i øre
  status: "pending" | "printed";
  stlGenerated: boolean;
};

// ─── Orders JSON ──────────────────────────────────────────────────────────────

export async function readOrders(): Promise<KeyringOrder[]> {
  const raw = await readJsonFile<KeyringOrder[]>("orders.json", []);
  // Migrate old orders that used gcodeGenerated
  return raw.map((o: Record<string, unknown>) => {
    if ("gcodeGenerated" in o && !("stlGenerated" in o)) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { gcodeGenerated, ...rest } = o as Record<string, unknown> & { gcodeGenerated: unknown };
      return { ...rest, stlGenerated: Boolean(gcodeGenerated) } as unknown as KeyringOrder;
    }
    return o as unknown as KeyringOrder;
  });
}

export async function writeOrders(orders: KeyringOrder[]): Promise<void> {
  await writeJsonFile("orders.json", orders);
}

// ─── STL files ────────────────────────────────────────────────────────────────

export async function saveStl(orderId: string, stl: Buffer): Promise<void> {
  await writeBinaryFile(`stl/${orderId}.stl`, stl);
}

export async function readStl(orderId: string): Promise<Buffer | null> {
  return readBinaryFile(`stl/${orderId}.stl`);
}

// ─── Order helpers ────────────────────────────────────────────────────────────

export async function createOrder(
  data: Omit<KeyringOrder, "id" | "createdAt" | "status" | "stlGenerated">
): Promise<KeyringOrder> {
  const orders = await readOrders();
  // Prevent duplicate orders for same Stripe session
  const existing = orders.find((o) => o.stripeSessionId === data.stripeSessionId);
  if (existing) return existing;

  const order: KeyringOrder = {
    id: `order-${Date.now()}`,
    createdAt: new Date().toISOString(),
    status: "pending",
    stlGenerated: false,
    ...data,
  };
  orders.unshift(order);
  await writeOrders(orders);
  return order;
}

export async function updateOrderStatus(orderId: string, status: "pending" | "printed"): Promise<void> {
  const orders = await readOrders();
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx !== -1) {
    orders[idx].status = status;
    await writeOrders(orders);
  }
}

export async function markStlGenerated(orderId: string): Promise<void> {
  const orders = await readOrders();
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx !== -1) {
    orders[idx].stlGenerated = true;
    await writeOrders(orders);
  }
}
