"use client";

import { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";
import { CartItem, ColorChoice, KeyringCartData, makeCartKey } from "./cart";
import { Product } from "./products";

const STORAGE_KEY = "printokay-cart-v1";

type AddItemOptions = {
  note?: string;
  colorChoices?: ColorChoice[];
  keyringData?: KeyringCartData;
};

type CartContextType = {
  items: CartItem[];
  hydrated: boolean; // true once localStorage has been read — safe to rely on items
  addItem: (product: Product, options?: AddItemOptions) => void;
  removeItem: (cartKey: string) => void;
  updateQuantity: (cartKey: string, quantity: number) => void;
  clearCart: () => void;
  totalItems: number;
};

const CartContext = createContext<CartContextType | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const savedOnce = useRef(false);

  // Load the persisted cart once, on mount (client-only — localStorage is not
  // available during SSR, so we read it inside an effect to avoid a hydration
  // mismatch).
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as CartItem[];
        if (Array.isArray(parsed)) setItems(parsed);
      }
    } catch {
      // Corrupt/unavailable storage — start with an empty cart.
    }
    setHydrated(true);
  }, []);

  // Persist the cart whenever it changes (but not before the initial load,
  // otherwise the empty starting state would wipe the saved cart).
  useEffect(() => {
    if (!hydrated) return;
    savedOnce.current = true;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // Storage full/unavailable — non-fatal, cart still works in-memory.
    }
  }, [hydrated, items]);

  function addItem(product: Product, options?: AddItemOptions) {
    const choices = options?.colorChoices ?? [];
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
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* non-fatal */ }
  }

  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0);

  return (
    <CartContext.Provider value={{ items, hydrated, addItem, removeItem, updateQuantity, clearCart, totalItems }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
