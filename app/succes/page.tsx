"use client";

import { useEffect } from "react";
import { useCart } from "@/lib/cartContext";
import Link from "next/link";

export default function SuccesPage() {
  const { clearCart } = useCart();

  useEffect(() => {
    clearCart();
  }, []);

  return (
    <div className="text-center py-24">
      <p className="text-7xl mb-6">🎉</p>
      <h1 className="text-3xl font-bold text-purple-800 mb-3">Tak for din bestilling!</h1>
      <p className="text-gray-600 text-lg mb-2">
        Du får en bekræftelse på din email.
      </p>
      <p className="text-gray-500 mb-8">
        Jeg printer dit produkt og sender det hurtigst muligt 💜
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
