"use client";

import Image from "next/image";
import { Product, formatPrice } from "@/lib/products";
import { useCart } from "@/lib/cartContext";
import { useState } from "react";

const hasRealImage = (img: string) =>
  img && img !== "/products/placeholder.jpg" && !img.endsWith("placeholder.jpg");

type Props = { product: Product; primaryColor: string; bgColor: string; categoryLabel: string };

export default function ProductCard({ product, primaryColor, bgColor, categoryLabel }: Props) {
  const { addItem } = useCart();
  const [added, setAdded] = useState(false);

  function handleAdd() {
    addItem(product);
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  }

  // Lighten the bg color slightly for the card image area
  const cardBg = `color-mix(in srgb, ${bgColor} 60%, white)`;

  return (
    <div className="bg-white rounded-2xl shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col">
      <div className="relative h-52 flex items-center justify-center" style={{ background: cardBg }}>
        {hasRealImage(product.image) ? (
          <Image src={product.image} alt={product.name} fill className="object-cover" unoptimized />
        ) : (
          <span className="text-7xl">{product.emoji}</span>
        )}
        <span
          className="absolute top-3 left-3 text-xs font-semibold px-2 py-1 rounded-full"
          style={{ backgroundColor: `color-mix(in srgb, ${primaryColor} 15%, white)`, color: primaryColor }}
        >
          {categoryLabel}
        </span>
      </div>

      <div className="p-4 flex flex-col flex-1 gap-2">
        <h3 className="font-semibold text-gray-800 text-lg">{product.name}</h3>
        <p className="text-gray-500 text-sm flex-1">{product.description}</p>
        <div className="flex items-center justify-between mt-2">
          <span className="font-bold text-lg" style={{ color: primaryColor }}>{formatPrice(product.price)}</span>
          <button
            onClick={handleAdd}
            className="px-4 py-2 rounded-full text-sm font-semibold text-white transition-all"
            style={{ backgroundColor: added ? "#22c55e" : primaryColor }}
          >
            {added ? "✓ Tilføjet!" : "Læg i kurv"}
          </button>
        </div>
      </div>
    </div>
  );
}
