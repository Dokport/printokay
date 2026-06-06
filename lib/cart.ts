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

export type CartItem = {
  product: Product;
  quantity: number;
  note?: string;
  colorChoices: ColorChoice[]; // one entry per color slot the customer chose
  cartKey: string; // unique per product + color combination
  keyringData?: KeyringCartData; // present only for keyring items
};

export function getItemPrice(item: CartItem): number {
  // Keyring items use the computed price, not product.price
  return item.keyringData ? item.keyringData.price : item.product.price;
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
