"use client";

import Link from "next/link";
import { useCart } from "@/lib/cartContext";

type Props = { siteName: string; logoEmoji: string; logoImage?: string; primaryColor: string; accentColor: string };

export default function Header({ siteName, logoEmoji, logoImage, primaryColor }: Props) {
  const { totalItems } = useCart();

  return (
    <header className="bg-white shadow-sm sticky top-0 z-50">
      <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2 min-w-0">
          {logoImage ? (
            <img src={logoImage} alt={siteName} className="h-8 w-8 sm:h-9 sm:w-9 object-cover rounded-lg flex-shrink-0" />
          ) : (
            <span className="text-2xl flex-shrink-0">{logoEmoji}</span>
          )}
          <span className="text-lg sm:text-xl font-bold truncate" style={{ color: primaryColor }}>{siteName}</span>
        </Link>

        <nav className="flex items-center gap-3 sm:gap-6 flex-shrink-0">
          <Link href="/" className="text-sm sm:text-base text-gray-600 hover:text-gray-900 font-medium transition-colors">
            Shop
          </Link>
          <Link href="/om" className="text-sm sm:text-base text-gray-600 hover:text-gray-900 font-medium transition-colors whitespace-nowrap">
            Om mig
          </Link>
          <Link
            href="/kurv"
            className="relative flex items-center gap-1 text-sm sm:text-base text-white px-3 sm:px-4 py-2 rounded-full font-medium transition-opacity hover:opacity-90 flex-shrink-0"
            style={{ backgroundColor: primaryColor }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/>
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
            </svg>
            <span className="hidden sm:inline">Kurv</span>
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
