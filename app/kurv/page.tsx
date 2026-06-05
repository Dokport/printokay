"use client";

import { useCart } from "@/lib/cartContext";
import { formatPrice } from "@/lib/products";
import { getCartTotal } from "@/lib/cart";
import Link from "next/link";
import { useState } from "react";

export default function KurvPage() {
  const { items, removeItem, updateQuantity, clearCart } = useCart();
  const [loading, setLoading] = useState(false);
  const total = getCartTotal(items);

  async function handleCheckout() {
    setLoading(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert("Noget gik galt. Prøv igen.");
      }
    } catch {
      alert("Noget gik galt. Prøv igen.");
    } finally {
      setLoading(false);
    }
  }

  if (items.length === 0) {
    return (
      <div className="text-center py-24">
        <p className="text-6xl mb-4">🛒</p>
        <h2 className="text-2xl font-semibold text-gray-700 mb-2">Din kurv er tom</h2>
        <p className="text-gray-500 mb-6">Gå tilbage og find noget lækkert!</p>
        <Link
          href="/"
          className="bg-purple-600 text-white px-6 py-3 rounded-full font-semibold hover:bg-purple-700 transition-colors"
        >
          Se produkter
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold text-purple-800 mb-8">Din kurv</h1>

      <div className="flex flex-col gap-4 mb-8">
        {items.map(({ product, quantity }) => (
          <div key={product.id} className="bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm">
            <div className="flex-1">
              <p className="font-semibold text-gray-800">{product.name}</p>
              <p className="text-purple-600 font-medium">{formatPrice(product.price)} stk.</p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => updateQuantity(product.id, quantity - 1)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center font-bold text-gray-600"
              >
                −
              </button>
              <span className="w-6 text-center font-semibold">{quantity}</span>
              <button
                onClick={() => updateQuantity(product.id, quantity + 1)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center font-bold text-gray-600"
              >
                +
              </button>
            </div>

            <p className="w-20 text-right font-bold text-gray-800">
              {formatPrice(product.price * quantity)}
            </p>

            <button
              onClick={() => removeItem(product.id)}
              className="text-red-400 hover:text-red-600 ml-2 text-lg"
              aria-label="Fjern"
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl p-6 shadow-sm">
        <div className="flex justify-between items-center mb-6 text-lg">
          <span className="text-gray-700 font-medium">Total</span>
          <span className="text-purple-700 font-bold text-2xl">{formatPrice(total)}</span>
        </div>
        <p className="text-gray-400 text-sm mb-4">Fragt beregnes ved betaling. Levering i hele Danmark.</p>
        <button
          onClick={handleCheckout}
          disabled={loading}
          className="w-full bg-purple-600 text-white py-4 rounded-full font-bold text-lg hover:bg-purple-700 transition-colors disabled:opacity-60"
        >
          {loading ? "Sender dig til betaling..." : "Betal sikkert →"}
        </button>
        <button
          onClick={clearCart}
          className="w-full mt-3 text-gray-400 hover:text-red-500 text-sm transition-colors"
        >
          Tøm kurv
        </button>
      </div>
    </div>
  );
}
