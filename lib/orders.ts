import fs from "fs";
import path from "path";
import type { KeyringConfig, KeyringSizeOption } from "./keyring";

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

const ORDERS_PATH = path.join(process.cwd(), "data", "orders.json");
const STL_DIR     = path.join(process.cwd(), "data", "stl");

export function readOrders(): KeyringOrder[] {
  try {
    if (!fs.existsSync(ORDERS_PATH)) return [];
    const raw = JSON.parse(fs.readFileSync(ORDERS_PATH, "utf-8"));
    // Migrate old orders that use gcodeGenerated field
    return raw.map((o: Record<string, unknown>) => {
      if ("gcodeGenerated" in o && !("stlGenerated" in o)) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { gcodeGenerated, ...rest } = o as Record<string, unknown> & { gcodeGenerated: unknown };
        return { ...rest, stlGenerated: Boolean(gcodeGenerated) } as unknown as KeyringOrder;
      }
      return o as unknown as KeyringOrder;
    });
  } catch {
    return [];
  }
}

export function writeOrders(orders: KeyringOrder[]): void {
  fs.writeFileSync(ORDERS_PATH, JSON.stringify(orders, null, 2));
}

export function saveStl(orderId: string, baseStl: Buffer, textStl: Buffer): void {
  if (!fs.existsSync(STL_DIR)) {
    fs.mkdirSync(STL_DIR, { recursive: true });
  }
  fs.writeFileSync(path.join(STL_DIR, `${orderId}-base.stl`), baseStl);
  fs.writeFileSync(path.join(STL_DIR, `${orderId}-text.stl`), textStl);
}

export function readStl(orderId: string): { baseStl: Buffer; textStl: Buffer } | null {
  const basePath = path.join(STL_DIR, `${orderId}-base.stl`);
  const textPath = path.join(STL_DIR, `${orderId}-text.stl`);
  if (!fs.existsSync(basePath) || !fs.existsSync(textPath)) return null;
  return {
    baseStl: fs.readFileSync(basePath),
    textStl: fs.readFileSync(textPath),
  };
}

export function createOrder(data: Omit<KeyringOrder, "id" | "createdAt" | "status" | "stlGenerated">): KeyringOrder {
  const order: KeyringOrder = {
    id: `order-${Date.now()}`,
    createdAt: new Date().toISOString(),
    status: "pending",
    stlGenerated: false,
    ...data,
  };
  const orders = readOrders();
  // Prevent duplicate orders for same Stripe session
  if (orders.some((o) => o.stripeSessionId === data.stripeSessionId)) {
    return orders.find((o) => o.stripeSessionId === data.stripeSessionId)!;
  }
  orders.unshift(order);
  writeOrders(orders);
  return order;
}

export function updateOrderStatus(orderId: string, status: "pending" | "printed"): void {
  const orders = readOrders();
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx !== -1) {
    orders[idx].status = status;
    writeOrders(orders);
  }
}

export function markStlGenerated(orderId: string): void {
  const orders = readOrders();
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx !== -1) {
    orders[idx].stlGenerated = true;
    writeOrders(orders);
  }
}
