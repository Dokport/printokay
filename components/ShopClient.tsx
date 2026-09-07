"use client";

import { useRef, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { Product } from "@/lib/products";
import { SiteSettings } from "@/lib/settings";
import ProductCard from "@/components/ProductCard";
import { getAdminToken } from "@/lib/adminSession";

// Load configurator lazily — pulls in three.js, only needed when tab is active.
const loading = () => (
  <div className="py-16 text-center text-gray-400 text-sm">Indlæser konfigurator…</div>
);
const KeyringConfigurator = dynamic(() => import("@/components/KeyringConfigurator"), { ssr: false, loading });
const FidgetConfigurator = dynamic(() => import("@/components/FidgetConfigurator"), { ssr: false, loading });

type Props = { products: Product[]; settings: SiteSettings };

const KEYRING_TAB = "__noglering__";
const FIDGET_TAB = "__fidget__";

export default function ShopClient({ products, settings }: Props) {
  const [activeCategory, setActiveCategory] = useState<string>("alle");
  // Only one product card may be in colour-select mode at a time (keeps a single
  // three.js canvas mounted). Holds the active product id.
  const [activeProductId, setActiveProductId] = useState<string | null>(null);
  const configRef = useRef<HTMLDivElement>(null);

  // ?noglering (where /noglering lands) opens the configurator straight away, so it
  // can be linked to and reloaded without clicking through the shop. Done after
  // mount rather than in the initial state: the server has no location to read, and
  // disagreeing with it there breaks hydration.
  /**
   * Admin may open a switched-off configurator through its direct link, so a product
   * can be test-printed before it goes on sale. The tab stays hidden for everyone,
   * and the server still refuses to price the thing — this only reveals the designer.
   */
  const [adminPreview, setAdminPreview] = useState(false);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.has("noglering")) { setActiveCategory(KEYRING_TAB); return; }
    if (!q.has("fidget")) return;
    if (settings.fidget?.enabled) { setActiveCategory(FIDGET_TAB); return; }

    const token = getAdminToken();
    if (!token) return;
    let cancelled = false;
    fetch("/api/admin-check", { headers: { "x-admin-token": token } })
      .then((res) => {
        if (cancelled || !res.ok) return;
        setAdminPreview(true);
        setActiveCategory(FIDGET_TAB);
      })
      .catch(() => { /* not admin — stays hidden */ });
    return () => { cancelled = true; };
    // settings arrive with the page and never change after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reset to shop view when header logo/Shop link is clicked while already on "/"
  useEffect(() => {
    const handler = () => {
      setActiveCategory("alle");
      window.history.replaceState(null, "", "/");
    };
    window.addEventListener("shop:reset", handler);
    return () => window.removeEventListener("shop:reset", handler);
  }, []);

  const filtered =
    activeCategory === "alle"
      ? products
      : products.filter((p) => p.category === activeCategory);

  const showKeyring = activeCategory === KEYRING_TAB;
  // A product that is switched off is not offered at all: no tab, and the deep
  // link falls back to the shop rather than opening something unbuyable.
  const fidgetOffered = settings.fidget?.enabled ?? false;
  const showFidget = (fidgetOffered || adminPreview) && activeCategory === FIDGET_TAB;
  const showConfigurator = showKeyring || showFidget;
  const { primaryColor, accentColor } = settings;

  function openFidget() {
    setActiveCategory(FIDGET_TAB);
    window.history.replaceState(null, "", "/?fidget");
    requestAnimationFrame(() => configRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function openKeyring() {
    setActiveCategory(KEYRING_TAB);
    // Make the configurator reloadable/shareable without a full route of its own.
    window.history.replaceState(null, "", "/?noglering");
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

      {/* ── Featured designers — hidden once one of them is open ── */}
      {!showConfigurator && (
      <div className={`mb-10 grid gap-4 ${fidgetOffered ? "lg:grid-cols-[3fr_2fr]" : ""}`}>
        <button
          onClick={openKeyring}
          className="group relative w-full overflow-hidden rounded-3xl text-left shadow-md hover:shadow-xl transition-shadow"
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

        {fidgetOffered && (
          <button
            onClick={openFidget}
            className="group relative overflow-hidden rounded-3xl text-left shadow-md hover:shadow-xl transition-shadow bg-gray-900"
          >
            <span className="pointer-events-none absolute -top-10 -left-8 w-48 h-48 rounded-full blur-2xl"
              style={{ backgroundColor: `${accentColor}44` }} />
            <span className="pointer-events-none absolute -bottom-16 -right-6 w-52 h-52 rounded-full blur-2xl"
              style={{ backgroundColor: `${primaryColor}55` }} />

            <div className="relative flex flex-col h-full p-7 sm:p-8">
              <span className="inline-flex self-start items-center gap-1.5 text-xs font-bold uppercase tracking-wider px-3 py-1 rounded-full bg-white text-gray-900 mb-3">
                ✨ Nyhed
              </span>
              <h2 className="text-2xl font-bold text-white mb-2">Byg din egen fidget clicker</h2>
              <p className="text-white/80 text-sm leading-relaxed mb-5">
                Rigtige mekaniske klik-knapper i en lille kasse. Vælg antal, farver og
                hvad der står på hver knap.
              </p>
              <span className="mt-auto inline-flex items-center gap-2 self-start px-5 py-2.5 rounded-full bg-white font-semibold text-sm text-gray-900 shadow-sm transition-transform group-hover:translate-x-0.5">
                Prøv den
                <span aria-hidden className="transition-transform group-hover:translate-x-1">→</span>
              </span>
            </div>
          </button>
        )}
      </div>
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

        {fidgetOffered && (
          <button
            onClick={openFidget}
            className="px-5 py-2 rounded-full font-medium transition-all border"
            style={
              showFidget
                ? { backgroundColor: primaryColor, color: "#fff", borderColor: primaryColor }
                : { backgroundColor: "#fff", color: primaryColor, borderColor: primaryColor }
            }
          >
            Custom Fidget
          </button>
        )}
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
      ) : showFidget ? (
        <div ref={configRef} className="scroll-mt-24">
          <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
            <div>
              <h2 className="text-2xl font-bold text-gray-800 mb-1">
                Design din fidget clicker
                {adminPreview && (
                  <span className="ml-2 align-middle text-xs font-semibold uppercase tracking-wider rounded-full bg-amber-100 text-amber-700 px-2.5 py-1">
                    Skjult for kunder
                  </span>
                )}
              </h2>
              <p className="text-gray-500">
                Vælg antal knapper, farver og hvad der står på hver — vi printer og samler den.
              </p>
            </div>
            <button
              onClick={() => setActiveCategory("alle")}
              className="text-sm font-medium text-gray-500 hover:text-gray-800 transition-colors"
            >
              ← Tilbage til shop
            </button>
          </div>
          <FidgetConfigurator />
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
              isActive={activeProductId === product.id}
              onActivate={setActiveProductId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
