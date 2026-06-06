"use client";

import { createContext, useContext, useState, ReactNode } from "react";
import { CartItem, ColorChoice, KeyringCartData, makeCartKey } from "./cart";
import { Product } from "./products";

type AddItemOptions = {
  note?: string;
  colorChoices?: ColorChoice[];
  keyringData?: KeyringCartData;
};

type CartContextType = {
  items: CartItem[];
  addItem: (product: Product, options?: AddItemOptions) => void;
  removeItem: (cartKey: string) => void;
  updateQuantity: (cartKey: string, quantity: number) => void;
  clearCart: () => void;
  totalItems: number;
};

const CartContext = createContext<CartContextType | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);

  function addItem(product: Product, options?: AddItemOptions) {
    const choices = options?.colorChoices ?? [];
    // Keyring items get a unique cartKey based on their config text
    const cartKey = options?.keyringData
      ? `keyring-${options.keyringData.text}-${options.keyringData.sizeId}-${options.keyringData.baseFilamentId}-${options.keyringData.textFilamentId}`
      : makeCartKey(product.id, choices);

    setItems((prev) => {
      const existing = prev.find((i) => i.cartKey === cartKey);
      if (existing) {
        return prev.map((i) =>
          i.cartKey === cartKey ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [
        ...prev,
        {
          product,
          quantity: 1,
          cartKey,
          note: options?.note,
          colorChoices: choices,
          keyringData: options?.keyringData,
        },
      ];
    });
  }

  function removeItem(cartKey: string) {
    setItems((prev) => prev.filter((i) => i.cartKey !== cartKey));
  }

  function updateQuantity(cartKey: string, quantity: number) {
    if (quantity <= 0) {
      removeItem(cartKey);
      return;
    }
    setItems((prev) =>
      prev.map((i) => (i.cartKey === cartKey ? { ...i, quantity } : i))
    );
  }

  function clearCart() {
    setItems([]);
  }

  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <CartContext.Provider value={{ items, addItem, removeItem, updateQuantity, clearCart, totalItems }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
