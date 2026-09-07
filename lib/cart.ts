import { Product, formatPrice } from "./products";
export { formatPrice };

export type ColorChoice = {
  slotId: string;
  slotLabel: string;
  filamentId: string;
  filamentName: string;
  filamentColor: string;
};

export type KeyringCartData = {
  text: string;
  font: string;
  shapeType: string;
  holePosition: "top" | "side";
  sizeId: string;
  sizeLabel: string;
  baseFilamentId: string;
  baseFilamentName: string;
  baseColorHex: string;
  textFilamentId: string;
  textFilamentName: string;
  textColorHex: string;
  fontSize: number;
  price: number; // i øre — beregnet ved tilføjelse
};

/**
 * A fidget clicker in the cart. Like the keyring, it carries everything needed to
 * rebuild the model, so an order never depends on the browser that placed it.
 */
export type FidgetCartData = {
  cols: number;
  rows: number;
  labels: string[];        // one per switch, row-major; "" is a blank cap
  boxFilamentId: string;
  boxFilamentName: string;
  boxColorHex: string;
  capFilamentId: string;
  capFilamentName: string;
  capColorHex: string;
  textFilamentId: string;
  textFilamentName: string;
  textColorHex: string;
  switchLabel: string;     // what was fitted, as it was described at the time
  price: number;           // i øre — beregnet ved tilføjelse
};

export type CartItem = {
  product: Product;
  quantity: number;
  note?: string;
  colorChoices: ColorChoice[]; // one entry per color slot the customer chose
  cartKey: string; // unique per product + color combination
  keyringData?: KeyringCartData; // present only for keyring items
  fidgetData?: FidgetCartData;   // present only for fidget items
};

export function getItemPrice(item: CartItem): number {
  // Made-to-order items carry the price worked out when they were configured;
  // a plain product has one on the product itself.
  if (item.keyringData) return item.keyringData.price;
  if (item.fidgetData) return item.fidgetData.price;
  return item.product.price;
}

export function getCartTotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + getItemPrice(item) * item.quantity, 0);
}

export function makeCartKey(productId: string, colorChoices: ColorChoice[]): string {
  if (colorChoices.length === 0) return productId;
  const suffix = colorChoices
    .map((c) => `${c.slotId}:${c.filamentId}`)
    .sort()
    .join(",");
  return `${productId}|${suffix}`;
}
