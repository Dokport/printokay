import { Product, formatPrice } from "./products";
export { formatPrice };

export type CartItem = {
  product: Product;
  quantity: number;
  note?: string;
};

export function getCartTotal(items: CartItem[]): number {
  return items.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
}
