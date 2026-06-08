"use client";

import { useEffect, useRef } from "react";
import { useCart } from "@/lib/cartContext";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

export default function SuccesPage() {
  const { clearCart } = useCart();
  const searchParams = useSearchParams();
  const orderPosted = useRef(false);

  // The order itself is recorded server-side from the stashed cart — primarily
  // by the Stripe webhook, with this finalize call as an instant fallback so the
  // order shows up right away. Both are idempotent and verify payment server-side.
  useEffect(() => {
    if (orderPosted.current) return;

    const sessionId = searchParams.get("session_id");
    if (!sessionId) {
      clearCart();
      return;
    }

    orderPosted.current = true;

    fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    })
      .catch((err) => console.error("Order finalize failed:", err))
      .finally(() => clearCart());
  }, []);

  return (
    <div className="text-center py-24">
      <p className="text-7xl mb-6">🎉</p>
      <h1 className="text-3xl font-bold text-purple-800 mb-3">Tak for din bestilling!</h1>
      <p className="text-gray-600 text-lg mb-2">
        Du får en bekræftelse på din email.
      </p>
      <p className="text-gray-500 mb-8">
        Jeg går i gang med at printe og sender det hurtigst muligt 💜
      </p>
      <Link
        href="/"
        className="bg-purple-600 text-white px-8 py-3 rounded-full font-semibold hover:bg-purple-700 transition-colors"
      >
        Tilbage til shoppen
      </Link>
    </div>
  );
}
