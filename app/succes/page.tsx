"use client";

import { useEffect, useRef } from "react";
import { useCart } from "@/lib/cartContext";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

export default function SuccesPage() {
  const { clearCart, items, hydrated } = useCart();
  const searchParams = useSearchParams();
  const orderPosted = useRef(false);

  // Wait until cart is hydrated from localStorage before processing.
  // Without this, items is [] on first render and the order never gets posted.
  useEffect(() => {
    if (!hydrated) return;
    if (orderPosted.current) return;

    const sessionId = searchParams.get("session_id");
    if (!sessionId) {
      clearCart();
      return;
    }

    orderPosted.current = true;

    // Post an order record for every keyring item in the cart.
    const keyringItems = items.filter((i) => i.keyringData);
    const postPromises = keyringItems.map((item) => {
      const kd = item.keyringData!;
      return fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          keyringConfig: {
            text: kd.text,
            font: kd.font,
            shapeType: kd.shapeType,
            holePosition: kd.holePosition ?? "top",
            sizeId: kd.sizeId,
            baseFilamentId: kd.baseFilamentId,
            textFilamentId: kd.textFilamentId,
            fontSize: kd.fontSize,
          },
          sizeId: kd.sizeId,
          baseColorHex: kd.baseColorHex,
          textColorHex: kd.textColorHex,
          baseFilamentName: kd.baseFilamentName,
          textFilamentName: kd.textFilamentName,
          pricePaid: kd.price,
        }),
      }).catch((err) => console.error("Order post failed:", err));
    });

    Promise.all(postPromises).finally(() => clearCart());
  }, [hydrated]);

  const hasKeyrings = items.some((i) => i.keyringData);

  return (
    <div className="text-center py-24">
      <p className="text-7xl mb-6">🎉</p>
      <h1 className="text-3xl font-bold text-purple-800 mb-3">Tak for din bestilling!</h1>
      <p className="text-gray-600 text-lg mb-2">
        Du får en bekræftelse på din email.
      </p>
      {hasKeyrings ? (
        <p className="text-gray-500 mb-8">
          Din nøglering er i kø og bliver printet hurtigst muligt 🔑💜
        </p>
      ) : (
        <p className="text-gray-500 mb-8">
          Jeg printer dit produkt og sender det hurtigst muligt 💜
        </p>
      )}
      <Link
        href="/"
        className="bg-purple-600 text-white px-8 py-3 rounded-full font-semibold hover:bg-purple-700 transition-colors"
      >
        Tilbage til shoppen
      </Link>
    </div>
  );
}
