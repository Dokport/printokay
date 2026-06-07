"use client";

import Image from "next/image";
import { Product, formatPrice } from "@/lib/products";
import { FilamentSpool } from "@/lib/settings";
import { ColorChoice } from "@/lib/cart";
import { useCart } from "@/lib/cartContext";
import { useState } from "react";

const hasRealImage = (img: string) =>
  img && img !== "/products/placeholder.jpg" && !img.endsWith("placeholder.jpg");

type Props = {
  product: Product;
  primaryColor: string;
  bgColor: string;
  categoryLabel: string;
  filaments: FilamentSpool[];
};

export default function ProductCard({ product, primaryColor, bgColor, categoryLabel, filaments }: Props) {
  const { addItem } = useCart();
  const [added, setAdded] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const [imgIndex, setImgIndex] = useState(0);

  // Per-slot selection: slotId -> filamentId
  const [slotChoices, setSlotChoices] = useState<Record<string, string>>({});

  // All images for this product (images array takes precedence over single image)
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

  function toggleSlot(slotId: string, filamentId: string) {
    setSlotChoices((prev) => ({
      ...prev,
      [slotId]: prev[slotId] === filamentId ? "" : filamentId,
    }));
  }

  function handleAdd() {
    const colorChoices: ColorChoice[] = (customizing ? slots : [])
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

  return (
    <div className="bg-white rounded-2xl shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col">
      <div className="relative h-52 flex items-center justify-center" style={{ background: cardBg }}>
        {hasImages ? (
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
          className="absolute top-3 left-3 text-xs font-semibold px-2 py-1 rounded-full"
          style={{ backgroundColor: `color-mix(in srgb, ${primaryColor} 15%, white)`, color: primaryColor }}
        >
          {categoryLabel}
        </span>
        {product.material && (
          <span className="absolute top-3 right-3 text-xs font-mono font-semibold px-2 py-1 rounded-full bg-white/80 text-gray-600 shadow-sm">
            {product.material}
          </span>
        )}
      </div>

      <div className="p-4 flex flex-col flex-1 gap-2">
        <h3 className="font-semibold text-gray-800 text-lg">{product.name}</h3>
        <p className="text-gray-500 text-sm flex-1">{product.description}</p>

        {/* Custom color toggle + pickers */}
        {hasSlots && availableFilaments.length > 0 && (
          <div className="mt-1">
            <button
              type="button"
              onClick={() => {
                setCustomizing((v) => !v);
                if (customizing) setSlotChoices({});
              }}
              className="flex items-center gap-2 text-sm font-medium transition-colors"
              style={{ color: customizing ? "#6b7280" : primaryColor }}
            >
              <span className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-colors text-white text-xs`}
                style={{
                  backgroundColor: customizing ? primaryColor : "transparent",
                  borderColor: customizing ? primaryColor : "#d1d5db",
                }}>
                {customizing && "✓"}
              </span>
              Vælg custom farver
            </button>

            {customizing && (
              <div className="flex flex-col gap-2 mt-3 pt-3 border-t border-gray-100">
                {slots.map((slot) => {
                  const chosen = slotChoices[slot.id];
                  const chosenFil = filaments.find((f) => f.id === chosen);
                  const isOpen = openSlot === slot.id;
                  return (
                    <div key={slot.id} className="relative">
                      <p className="text-xs font-medium text-gray-500 mb-1">{slot.label}</p>
                      {/* Trigger button */}
                      <button
                        type="button"
                        onClick={() => setOpenSlot(isOpen ? null : slot.id)}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border text-sm transition-colors bg-white"
                        style={{ borderColor: isOpen ? primaryColor : "#e5e7eb" }}
                      >
                        {chosenFil ? (
                          <span className="flex items-center gap-2">
                            <span className="w-4 h-4 rounded-full flex-shrink-0 border border-gray-200"
                              style={{ backgroundColor: chosenFil.colorHex }} />
                            <span className="font-medium text-gray-700">{chosenFil.name}</span>
                            <span className="text-gray-400 text-xs font-mono">{chosenFil.material}</span>
                          </span>
                        ) : (
                          <span className="text-gray-400">Vælg farve...</span>
                        )}
                        <span className="text-gray-400 text-xs">{isOpen ? "▲" : "▼"}</span>
                      </button>

                      {/* Dropdown list */}
                      {isOpen && (
                        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-20 max-h-48 overflow-y-auto">
                          {/* Clear option */}
                          {chosen && (
                            <button type="button"
                              onClick={() => { toggleSlot(slot.id, chosen); setOpenSlot(null); }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:bg-gray-50 border-b border-gray-100">
                              <span className="w-4 h-4 rounded-full border-2 border-dashed border-gray-300 flex-shrink-0" />
                              Fjern valg
                            </button>
                          )}
                          {availableFilaments.map((f) => (
                            <button
                              key={f.id}
                              type="button"
                              onClick={() => { toggleSlot(slot.id, f.id); setOpenSlot(null); }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 transition-colors"
                              style={{ backgroundColor: chosen === f.id ? `color-mix(in srgb, ${primaryColor} 8%, white)` : undefined }}
                            >
                              <span className="w-4 h-4 rounded-full flex-shrink-0 border border-gray-200"
                                style={{ backgroundColor: f.colorHex }} />
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
          </div>
        )}

        {(() => {
          const missingSlots = customizing
            ? slots.filter((s) => !slotChoices[s.id])
            : [];
          const blocked = missingSlots.length > 0;
          return (
            <div className="flex flex-col gap-2 mt-2">
              {blocked && (
                <p className="text-xs text-amber-600 font-medium">
                  Mangler farvevalg: {missingSlots.map((s) => s.label).join(", ")}
                </p>
              )}
              <div className="flex items-center justify-between">
                <span className="font-bold text-lg" style={{ color: primaryColor }}>{formatPrice(product.price)}</span>
                <button
                  onClick={handleAdd}
                  disabled={blocked}
                  className="px-4 py-2 rounded-full text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ backgroundColor: added ? "#22c55e" : primaryColor }}
                >
                  {added ? "✓ Tilføjet!" : "Læg i kurv"}
                </button>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
