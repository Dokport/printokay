"use client";

import { useCart } from "@/lib/cartContext";
import { formatPrice } from "@/lib/products";
import { getCartTotal, getItemPrice } from "@/lib/cart";
import { ShippingOption } from "@/lib/settings";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function KurvPage() {
  const { items, removeItem, updateQuantity, clearCart } = useCart();
  const [loading, setLoading] = useState(false);
  const [shippingOptions, setShippingOptions] = useState<ShippingOption[]>([]);
  const [selectedShipping, setSelectedShipping] = useState<string>("");
  const subtotal = getCartTotal(items);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.shippingOptions) && d.shippingOptions.length > 0) {
          setShippingOptions(d.shippingOptions);
          setSelectedShipping(d.shippingOptions[0].id);
        }
      });
  }, []);

  const selectedOption = shippingOptions.find((s) => s.id === selectedShipping);
  const shippingPrice = selectedOption?.price ?? 0;
  const total = subtotal + shippingPrice;

  async function handleCheckout() {
    if (!selectedShipping) return;
    setLoading(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, shippingOptionId: selectedShipping }),
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
        <Link href="/" className="bg-purple-600 text-white px-6 py-3 rounded-full font-semibold hover:bg-purple-700 transition-colors">
          Se produkter
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold text-purple-800 mb-8">Din kurv</h1>

      <div className="flex flex-col gap-4 mb-6">
        {items.map((item) => {
          const isKeyring = !!item.keyringData;
          const itemPrice = getItemPrice(item);
          const kd = item.keyringData;
          return (
          <div key={item.cartKey} className="bg-white rounded-2xl p-4 flex items-center gap-4 shadow-sm">
            <div className="text-2xl flex-shrink-0">{item.product.emoji}</div>
            <div className="flex-1 min-w-0">
              {isKeyring && kd ? (
                <>
                  <p className="font-semibold text-gray-800">🔑 Nøglering: &ldquo;{kd.text}&rdquo;</p>
                  <p className="text-xs text-gray-400 mt-0.5">{kd.sizeLabel} · {kd.font.replace(/-/g, " ")}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <div className="flex items-center gap-1">
                      <span className="w-3 h-3 rounded-full border border-gray-200 flex-shrink-0"
                        style={{ backgroundColor: kd.baseColorHex }} />
                      <span className="text-xs text-gray-400">{kd.baseFilamentName}</span>
                    </div>
                    {kd.baseFilamentId !== kd.textFilamentId && (
                      <>
                        <span className="text-gray-200">+</span>
                        <div className="flex items-center gap-1">
                          <span className="w-3 h-3 rounded-full border border-gray-200 flex-shrink-0"
                            style={{ backgroundColor: kd.textColorHex }} />
                          <span className="text-xs text-gray-400">{kd.textFilamentName}</span>
                        </div>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p className="font-semibold text-gray-800">{item.product.name}</p>
                  {item.colorChoices && item.colorChoices.length > 0 && (
                    <div className="flex flex-col gap-0.5 mt-1">
                      {item.colorChoices.map((c) => (
                        <div key={c.slotId} className="flex items-center gap-1.5">
                          <span className="w-3 h-3 rounded-full flex-shrink-0 border border-gray-200"
                            style={{ backgroundColor: c.filamentColor }} />
                          <span className="text-xs text-gray-500">
                            <span className="text-gray-400">{c.slotLabel}:</span> {c.filamentName}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
              <p className="text-purple-600 font-medium text-sm mt-1">{formatPrice(itemPrice)} stk.</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => updateQuantity(item.cartKey, item.quantity - 1)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center font-bold text-gray-600">−</button>
              <span className="w-6 text-center font-semibold">{item.quantity}</span>
              <button onClick={() => updateQuantity(item.cartKey, item.quantity + 1)}
                className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center font-bold text-gray-600">+</button>
            </div>
            <p className="w-20 text-right font-bold text-gray-800">{formatPrice(itemPrice * item.quantity)}</p>
            <button onClick={() => removeItem(item.cartKey)} className="text-red-400 hover:text-red-600 ml-2 text-lg" aria-label="Fjern">✕</button>
          </div>
          );
        })}
      </div>

      {shippingOptions.length > 0 && (
        <div className="bg-white rounded-2xl p-6 shadow-sm mb-6">
          <h2 className="font-semibold text-gray-800 mb-4">🚚 Vælg levering</h2>
          <div className="flex flex-col gap-3">
            {shippingOptions.map((opt) => (
              <label key={opt.id}
                className={`flex items-center justify-between gap-3 p-4 rounded-xl border-2 cursor-pointer transition-all ${selectedShipping === opt.id ? "border-purple-400 bg-purple-50" : "border-gray-100 hover:border-purple-200"}`}>
                <div className="flex items-center gap-3">
                  <input type="radio" name="shipping" value={opt.id} checked={selectedShipping === opt.id}
                    onChange={() => setSelectedShipping(opt.id)} className="accent-purple-600 w-4 h-4" />
                  <div>
                    <p className="font-medium text-gray-800">{opt.name}</p>
                    <p className="text-sm text-gray-500">{opt.minDays}–{opt.maxDays} hverdage</p>
                  </div>
                </div>
                <span className="font-bold text-gray-800 whitespace-nowrap">
                  {opt.price === 0 ? "Gratis" : formatPrice(opt.price)}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col gap-2 mb-6">
          <div className="flex justify-between text-gray-600">
            <span>Varer</span>
            <span>{formatPrice(subtotal)}</span>
          </div>
          <div className="flex justify-between text-gray-600">
            <span>Fragt</span>
            <span>{shippingPrice === 0 ? "Gratis" : formatPrice(shippingPrice)}</span>
          </div>
          <div className="flex justify-between text-lg font-bold text-gray-900 pt-2 border-t border-gray-100">
            <span>Total</span>
            <span className="text-purple-700 text-2xl">{formatPrice(total)}</span>
          </div>
        </div>
        <button onClick={handleCheckout} disabled={loading || !selectedShipping}
          className="w-full bg-purple-600 text-white py-4 rounded-full font-bold text-lg hover:bg-purple-700 transition-colors disabled:opacity-60">
          {loading ? "Sender dig til betaling..." : "Betal sikkert →"}
        </button>
        <button onClick={clearCart} className="w-full mt-3 text-gray-400 hover:text-red-500 text-sm transition-colors">
          Tøm kurv
        </button>
      </div>
    </div>
  );
}
