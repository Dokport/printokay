"use client";

import Image from "next/image";
import dynamic from "next/dynamic";
import { Product, formatPrice } from "@/lib/products";
import { FilamentSpool } from "@/lib/settings";
import { ColorChoice } from "@/lib/cart";
import { useCart } from "@/lib/cartContext";
import { useMemo, useState } from "react";

// three.js viewer is client-only and heavy — load on demand (only the active card mounts it).
const Product3DPreview = dynamic(() => import("./Product3DPreview"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-52 flex items-center justify-center text-sm text-gray-400 bg-gray-50">
      Indlæser 3D-model…
    </div>
  ),
});

const hasRealImage = (img: string) =>
  img && img !== "/products/placeholder.jpg" && !img.endsWith("placeholder.jpg");

function hexToRgb(h: string): [number, number, number] {
  const s = h.replace("#", "");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

// Nearest in-stock filament to a target hex (squared RGB distance).
function nearestFilamentId(hex: string | undefined, fils: FilamentSpool[]): string | undefined {
  if (!hex || !fils.length) return undefined;
  const t = hexToRgb(hex);
  let best: FilamentSpool | null = null, bd = Infinity;
  for (const f of fils) {
    const c = hexToRgb(f.colorHex);
    const d = (c[0] - t[0]) ** 2 + (c[1] - t[1]) ** 2 + (c[2] - t[2]) ** 2;
    if (d < bd) { bd = d; best = f; }
  }
  return best?.id;
}

// Default filament per slot = nearest in-stock filament to the model's zone colour.
function computeDefaultChoices(product: Product, filaments: FilamentSpool[]): Record<string, string> {
  const avail = filaments.filter((f) => f.inStock && (!product.material || f.material === product.material));
  const out: Record<string, string> = {};
  for (const z of product.colorZones ?? []) {
    if (out[z.slotId]) continue;
    const fid = nearestFilamentId(z.color, avail);
    if (fid) out[z.slotId] = fid;
  }
  return out;
}

type Props = {
  product: Product;
  primaryColor: string;
  bgColor: string;
  categoryLabel: string;
  filaments: FilamentSpool[];
  isActive: boolean;
  onActivate: (id: string) => void;
};

export default function ProductCard({
  product, primaryColor, bgColor, categoryLabel, filaments, isActive, onActivate,
}: Props) {
  const { addItem } = useCart();
  const [added, setAdded] = useState(false);
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const [imgIndex, setImgIndex] = useState(0);
  const [topView, setTopView] = useState<"3d" | "foto">("3d");

  // Per-slot selection: slotId -> filamentId. Pre-filled with the model's own
  // colours (nearest in-stock filament) so a sensible default is shown up front.
  const [slotChoices, setSlotChoices] = useState<Record<string, string>>(
    () => computeDefaultChoices(product, filaments)
  );

  const allImages = (product.images && product.images.length > 0
    ? product.images
    : product.image ? [product.image] : []
  ).filter(hasRealImage);
  const hasImages = allImages.length > 0;
  const currentImg = allImages[imgIndex] ?? "";

  const slots = product.colorSlots ?? [];
  const hasSlots = slots.length > 0;

  // In-stock filaments matching product material (or all if no material set)
  const availableFilaments = filaments.filter(
    (f) => f.inStock && (!product.material || f.material === product.material)
  );

  const has3D = !!product.modelFile && (product.colorZones?.length ?? 0) > 0;
  const customizable = hasSlots && availableFilaments.length > 0;

  // zone-key → chosen filament hex (drives the live 3D colours)
  const zoneColors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const z of product.colorZones ?? []) {
      const fil = filaments.find((f) => f.id === slotChoices[z.slotId]);
      if (fil) out[z.key] = fil.colorHex;
    }
    return out;
  }, [product.colorZones, slotChoices, filaments]);

  function toggleSlot(slotId: string, filamentId: string) {
    setSlotChoices((prev) => ({
      ...prev,
      [slotId]: prev[slotId] === filamentId ? "" : filamentId,
    }));
  }

  function handleAdd() {
    const colorChoices: ColorChoice[] = slots
      .filter((slot) => slotChoices[slot.id])
      .map((slot) => {
        const fil = filaments.find((f) => f.id === slotChoices[slot.id])!;
        return {
          slotId: slot.id,
          slotLabel: slot.label,
          filamentId: fil.id,
          filamentName: fil.name,
          filamentColor: fil.colorHex,
        };
      });
    addItem(product, colorChoices.length > 0 ? { colorChoices } : undefined);
    setAdded(true);
    setTimeout(() => setAdded(false), 1500);
  }

  const cardBg = `color-mix(in srgb, ${bgColor} 60%, white)`;
  const missingSlots = customizable ? slots.filter((s) => !slotChoices[s.id]) : [];
  const blocked = missingSlots.length > 0;
  const canShow3D = isActive && customizable && has3D;
  const show3D = canShow3D && topView === "3d";

  return (
    <div className="bg-white rounded-2xl shadow-sm hover:shadow-md transition-shadow flex flex-col">
      {/* ── Top: 3D preview (active + has model) OR image ── */}
      <div className="relative h-52 flex items-center justify-center overflow-hidden rounded-t-2xl" style={{ background: cardBg }}>
        {show3D ? (
          <Product3DPreview
            productId={product.id}
            zoneColors={zoneColors}
            version={product.previewModel || product.modelFile}
            className="w-full h-52"
          />
        ) : hasImages ? (
          <>
            <Image src={currentImg} alt={`${product.name} ${imgIndex + 1}`} fill className="object-cover" unoptimized />
            {allImages.length > 1 && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); setImgIndex((i) => (i - 1 + allImages.length) % allImages.length); }}
                  className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/40 text-white flex items-center justify-center text-xs hover:bg-black/60 transition-colors z-10"
                >‹</button>
                <button
                  onClick={(e) => { e.stopPropagation(); setImgIndex((i) => (i + 1) % allImages.length); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-black/40 text-white flex items-center justify-center text-xs hover:bg-black/60 transition-colors z-10"
                >›</button>
                <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1 z-10">
                  {allImages.map((_, i) => (
                    <button
                      key={i}
                      onClick={(e) => { e.stopPropagation(); setImgIndex(i); }}
                      className="w-1.5 h-1.5 rounded-full transition-colors"
                      style={{ backgroundColor: i === imgIndex ? "white" : "rgba(255,255,255,0.45)" }}
                    />
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <span className="text-7xl">{product.emoji}</span>
        )}
        <span
          className="absolute top-3 left-3 text-xs font-semibold px-2 py-1 rounded-full z-10"
          style={{ backgroundColor: `color-mix(in srgb, ${primaryColor} 15%, white)`, color: primaryColor }}
        >
          {categoryLabel}
        </span>
        {product.material && (
          <span className="absolute top-3 right-3 text-xs font-mono font-semibold px-2 py-1 rounded-full bg-white/80 text-gray-600 shadow-sm z-10">
            {product.material}
          </span>
        )}
        {show3D && (
          <span className="absolute bottom-2 right-3 text-[10px] text-gray-400 z-10">træk for at rotere</span>
        )}
        {/* 3D ⇄ Foto toggle (only when active model + real images exist) */}
        {canShow3D && hasImages && (
          <div className="absolute bottom-2 left-2 z-10 flex rounded-full bg-white/85 shadow-sm overflow-hidden text-[11px] font-medium">
            <button
              type="button"
              onClick={() => setTopView("3d")}
              className="px-2.5 py-1 transition-colors"
              style={topView === "3d" ? { backgroundColor: primaryColor, color: "#fff" } : { color: "#6b7280" }}
            >3D</button>
            <button
              type="button"
              onClick={() => setTopView("foto")}
              className="px-2.5 py-1 transition-colors"
              style={topView === "foto" ? { backgroundColor: primaryColor, color: "#fff" } : { color: "#6b7280" }}
            >Foto</button>
          </div>
        )}
      </div>

      <div className="p-4 flex flex-col flex-1 gap-2">
        <h3 className="font-semibold text-gray-800 text-lg">{product.name}</h3>
        <p className="text-gray-500 text-sm flex-1">{product.description}</p>

        {/* ── Forced colour pickers (only when this card is active) ── */}
        {customizable && isActive && (
          <div className="flex flex-col gap-2 mt-1 pt-3 border-t border-gray-100">
            <p className="text-xs font-semibold" style={{ color: primaryColor }}>Vælg dine farver</p>
            {slots.map((slot) => {
              const chosen = slotChoices[slot.id];
              const chosenFil = filaments.find((f) => f.id === chosen);
              const isOpen = openSlot === slot.id;
              return (
                <div key={slot.id} className="relative">
                  <p className="text-xs font-medium text-gray-500 mb-1">{slot.label}</p>
                  <button
                    type="button"
                    onClick={() => setOpenSlot(isOpen ? null : slot.id)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-sm transition-colors bg-white"
                    style={{ borderColor: isOpen ? primaryColor : chosenFil ? "#e5e7eb" : "#fca5a5" }}
                  >
                    {chosenFil ? (
                      <span className="flex items-center gap-2">
                        <span className="w-4 h-4 rounded-full flex-shrink-0 border border-gray-200" style={{ backgroundColor: chosenFil.colorHex }} />
                        <span className="font-medium text-gray-700">{chosenFil.name}</span>
                        <span className="text-gray-400 text-xs font-mono">{chosenFil.material}</span>
                      </span>
                    ) : (
                      <span className="text-gray-400">Vælg farve…</span>
                    )}
                    <span className="text-gray-400 text-xs">{isOpen ? "▲" : "▼"}</span>
                  </button>

                  {isOpen && (
                    <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 max-h-48 overflow-y-auto">
                      {availableFilaments.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => { toggleSlot(slot.id, f.id); setOpenSlot(null); }}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 transition-colors"
                          style={{ backgroundColor: chosen === f.id ? `color-mix(in srgb, ${primaryColor} 8%, white)` : undefined }}
                        >
                          <span className="w-4 h-4 rounded-full flex-shrink-0 border border-gray-200" style={{ backgroundColor: f.colorHex }} />
                          <span className="font-medium text-gray-700 flex-1 text-left">{f.name}</span>
                          <span className="text-gray-400 text-xs font-mono">{f.material}</span>
                          {chosen === f.id && <span style={{ color: primaryColor }}>✓</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Footer: price + action ── */}
        <div className="flex flex-col gap-2 mt-2">
          {blocked && isActive && (
            <p className="text-xs text-amber-600 font-medium">
              Vælg farve for: {missingSlots.map((s) => s.label).join(", ")}
            </p>
          )}
          {customizable && availableFilaments.length === 0 && (
            <p className="text-xs text-red-500 font-medium">Udsolgt — ingen farver på lager lige nu</p>
          )}
          <div className="flex items-center justify-between">
            <span className="font-bold text-lg" style={{ color: primaryColor }}>{formatPrice(product.price)}</span>
            {customizable && !isActive ? (
              <button
                onClick={() => onActivate(product.id)}
                className="px-4 py-2 rounded-full text-sm font-semibold text-white transition-all"
                style={{ backgroundColor: primaryColor }}
              >
                Vælg farver
              </button>
            ) : (
              <button
                onClick={handleAdd}
                disabled={blocked}
                className="px-4 py-2 rounded-full text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: added ? "#22c55e" : primaryColor }}
              >
                {added ? "✓ Tilføjet!" : "Læg i kurv"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
