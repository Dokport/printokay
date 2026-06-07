"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Product } from "@/lib/products";
import { SiteSettings } from "@/lib/settings";
import ProductCard from "@/components/ProductCard";

// Load configurator lazily — pulls in three.js, only needed when tab is active.
const KeyringConfigurator = dynamic(
  () => import("@/components/KeyringConfigurator"),
  { ssr: false, loading: () => <div className="py-16 text-center text-gray-400 text-sm">Indlæser konfigurator…</div> }
);

type Props = { products: Product[]; settings: SiteSettings };

const KEYRING_TAB = "__noglering__";

export default function ShopClient({ products, settings }: Props) {
  const [activeCategory, setActiveCategory] = useState<string>("alle");
  const configRef = useRef<HTMLDivElement>(null);

  const filtered =
    activeCategory === "alle"
      ? products
      : products.filter((p) => p.category === activeCategory);

  const showKeyring = activeCategory === KEYRING_TAB;
  const { primaryColor, accentColor } = settings;

  function openKeyring() {
    setActiveCategory(KEYRING_TAB);
    // Let the config render, then bring it into view smoothly.
    requestAnimationFrame(() => {
      configRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  return (
    <div>
      <section className="text-center pt-12 pb-8">
        <h1 className="text-4xl font-bold mb-3" style={{ color: primaryColor }}>
          {settings.heroTitle}
        </h1>
        <p className="text-gray-600 text-lg max-w-xl mx-auto">{settings.tagline}</p>
      </section>

      {/* ── Featured: Custom Nøglering — hidden once configurator is open ── */}
      {!showKeyring && (
        <button
          onClick={openKeyring}
          className="group relative w-full mb-10 overflow-hidden rounded-3xl text-left shadow-md hover:shadow-xl transition-shadow"
          style={{ background: `linear-gradient(135deg, ${primaryColor} 0%, ${accentColor} 100%)` }}
        >
          <span className="pointer-events-none absolute -top-16 -right-10 w-64 h-64 rounded-full bg-white/10 blur-2xl" />
          <span className="pointer-events-none absolute -bottom-20 right-1/3 w-56 h-56 rounded-full bg-white/10 blur-2xl" />

          <div className="relative flex flex-col sm:flex-row items-start sm:items-center gap-5 p-7 sm:p-9">
            <div className="flex-1">
              <span className="inline-block text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-white/25 text-white mb-3 backdrop-blur-sm">
                ★ Mest populære
              </span>
              <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">
                Design din egen nøglering
              </h2>
              <p className="text-white/90 text-sm sm:text-base max-w-lg leading-relaxed">
                Skriv din tekst, vælg form og to farver — og se din nøglering i ægte 3D,
                før du bestiller. Printet og sendt direkte fra mit værksted.
              </p>
            </div>
            <span
              className="flex-shrink-0 inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white font-semibold text-base shadow-sm transition-transform group-hover:translate-x-0.5"
              style={{ color: primaryColor }}
            >
              Start dit design
              <span aria-hidden className="transition-transform group-hover:translate-x-1">→</span>
            </span>
          </div>
        </button>
      )}

      {/* Category tabs */}
      <div className="flex gap-3 mb-8 flex-wrap items-center">
        {[{ id: "alle", label: "Alle", emoji: "" }, ...settings.categories].map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className="px-5 py-2 rounded-full font-medium transition-all border"
            style={
              activeCategory === cat.id
                ? { backgroundColor: primaryColor, color: "#fff", borderColor: primaryColor }
                : { backgroundColor: "#fff", color: "#4b5563", borderColor: "#e5e7eb" }
            }
          >
            {cat.emoji && <span className="mr-1">{cat.emoji}</span>}
            {cat.label}
          </button>
        ))}

        {/* Nøglering tab — kept for quick access alongside the featured banner */}
        <button
          onClick={openKeyring}
          className="px-5 py-2 rounded-full font-medium transition-all border"
          style={
            showKeyring
              ? { backgroundColor: primaryColor, color: "#fff", borderColor: primaryColor }
              : { backgroundColor: "#fff", color: primaryColor, borderColor: primaryColor }
          }
        >
          Custom Nøglering
        </button>
      </div>

      {/* Content */}
      {showKeyring ? (
        <div ref={configRef} className="scroll-mt-24">
          <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
            <div>
              <h2 className="text-2xl font-bold text-gray-800 mb-1">Design din nøglering</h2>
              <p className="text-gray-500">Vælg tekst, font, form og farver — vi 3D-printer den til dig.</p>
            </div>
            <button
              onClick={() => setActiveCategory("alle")}
              className="text-sm font-medium text-gray-500 hover:text-gray-800 transition-colors"
            >
              ← Tilbage til shop
            </button>
          </div>
          <KeyringConfigurator />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-center text-gray-400 py-12">Ingen produkter i denne kategori endnu.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              primaryColor={primaryColor}
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
