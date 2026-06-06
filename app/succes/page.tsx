"use client";

import { useEffect, useState, useRef } from "react";
import { useCart } from "@/lib/cartContext";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

export default function SuccesPage() {
  const { clearCart, items } = useCart();
  const searchParams = useSearchParams();
  const [keyringOrdered, setKeyringOrdered] = useState(false);
  const orderPosted = useRef(false);

  useEffect(() => {
    const sessionId = searchParams.get("session_id");

    // Find keyring items in cart before clearing
    const keyringItem = items.find((i) => i.keyringData);

    if (keyringItem && sessionId && !orderPosted.current) {
      orderPosted.current = true;
      const kd = keyringItem.keyringData!;

      // Post order to API
      fetch("/api/orders", {
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
      })
        .then(() => setKeyringOrdered(true))
        .catch((err) => {
          console.error("Order post failed:", err);
          setKeyringOrdered(true); // still show success to customer
        });
    }

    clearCart();
  }, []);

  return (
    <div className="text-center py-24">
      <p className="text-7xl mb-6">🎉</p>
      <h1 className="text-3xl font-bold text-purple-800 mb-3">Tak for din bestilling!</h1>
      <p className="text-gray-600 text-lg mb-2">
        Du får en bekræftelse på din email.
      </p>
      {keyringOrdered ? (
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
