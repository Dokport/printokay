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
  gcodeGenerated: boolean;
};

const ORDERS_PATH = path.join(process.cwd(), "data", "orders.json");
const GCODES_DIR  = path.join(process.cwd(), "data", "gcodes");

export function readOrders(): KeyringOrder[] {
  try {
    if (!fs.existsSync(ORDERS_PATH)) return [];
    return JSON.parse(fs.readFileSync(ORDERS_PATH, "utf-8"));
  } catch {
    return [];
  }
}

export function writeOrders(orders: KeyringOrder[]): void {
  fs.writeFileSync(ORDERS_PATH, JSON.stringify(orders, null, 2));
}

export function saveGcode(orderId: string, gcode: string): void {
  if (!fs.existsSync(GCODES_DIR)) {
    fs.mkdirSync(GCODES_DIR, { recursive: true });
  }
  fs.writeFileSync(path.join(GCODES_DIR, `${orderId}.gcode`), gcode, "utf-8");
}

export function readGcode(orderId: string): string | null {
  const gcodeFile = path.join(GCODES_DIR, `${orderId}.gcode`);
  if (!fs.existsSync(gcodeFile)) return null;
  return fs.readFileSync(gcodeFile, "utf-8");
}

export function createOrder(data: Omit<KeyringOrder, "id" | "createdAt" | "status" | "gcodeGenerated">): KeyringOrder {
  const order: KeyringOrder = {
    id: `order-${Date.now()}`,
    createdAt: new Date().toISOString(),
    status: "pending",
    gcodeGenerated: false,
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

export function markGcodeGenerated(orderId: string): void {
  const orders = readOrders();
  const idx = orders.findIndex((o) => o.id === orderId);
  if (idx !== -1) {
    orders[idx].gcodeGenerated = true;
    writeOrders(orders);
  }
}
