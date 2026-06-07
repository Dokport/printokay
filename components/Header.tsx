"use client";

import Link from "next/link";
import { useCart } from "@/lib/cartContext";

type Props = { siteName: string; logoEmoji: string; logoImage?: string; primaryColor: string; accentColor: string };

export default function Header({ siteName, logoEmoji, logoImage, primaryColor }: Props) {
  const { totalItems } = useCart();

  return (
    <header className="bg-white shadow-sm sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          {logoImage ? (
            <img src={logoImage} alt={siteName} className="h-9 w-9 object-cover rounded-lg" />
          ) : (
            <span className="text-2xl">{logoEmoji}</span>
          )}
          <span className="text-xl font-bold" style={{ color: primaryColor }}>{siteName}</span>
        </Link>

        <nav className="flex items-center gap-6">
          <Link href="/" className="text-gray-600 hover:text-gray-900 font-medium transition-colors">
            Shop
          </Link>
          <Link href="/om" className="text-gray-600 hover:text-gray-900 font-medium transition-colors">
            Om mig
          </Link>
          <Link
            href="/kurv"
            className="relative flex items-center gap-1 text-white px-4 py-2 rounded-full font-medium transition-opacity hover:opacity-90"
            style={{ backgroundColor: primaryColor }}
          >
            🛒 Kurv
            {totalItems > 0 && (
              <span
                className="absolute -top-2 -right-2 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold"
                style={{ backgroundColor: "var(--color-accent)" }}
              >
                {totalItems}
              </span>
            )}
          </Link>
        </nav>
      </div>
    </header>
  );
}
