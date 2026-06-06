"use client";

import { useState } from "react";
import { Product } from "@/lib/products";
import { SiteSettings } from "@/lib/settings";
import ProductCard from "@/components/ProductCard";

type Props = { products: Product[]; settings: SiteSettings };

export default function ShopClient({ products, settings }: Props) {
  const [activeCategory, setActiveCategory] = useState<string>("alle");

  const filtered =
    activeCategory === "alle" ? products : products.filter((p) => p.category === activeCategory);

  return (
    <div>
      <section className="text-center py-12 mb-8">
        <h1 className="text-4xl font-bold mb-3" style={{ color: settings.primaryColor }}>
          {settings.heroTitle}
        </h1>
        <p className="text-gray-600 text-lg max-w-xl mx-auto">{settings.tagline}</p>
      </section>

      <div className="flex gap-3 mb-8 flex-wrap">
        {[{ id: "alle", label: "Alle", emoji: "" }, ...settings.categories].map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className="px-5 py-2 rounded-full font-medium transition-all border"
            style={
              activeCategory === cat.id
                ? { backgroundColor: settings.primaryColor, color: "#fff", borderColor: settings.primaryColor }
                : { backgroundColor: "#fff", color: "#4b5563", borderColor: "#e5e7eb" }
            }
          >
            {cat.emoji && <span className="mr-1">{cat.emoji}</span>}
            {cat.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-center text-gray-400 py-12">Ingen produkter i denne kategori endnu.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              primaryColor={settings.primaryColor}
              bgColor={settings.bgColor}
              categoryLabel={settings.categories.find((c) => c.id === product.category)?.label ?? product.category}
              filaments={settings.filaments ?? []}
            />
          ))}
        </div>
      )}
    </div>
  );
}
