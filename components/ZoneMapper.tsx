"use client";

/**
 * Admin tool: map a model's detected paint_color zones to the product's
 * colorSlots. Shows the live 3D model (highlighting the zone being mapped) so
 * it's obvious which region is which.
 */

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { ColorZone } from "@/lib/products";

const Product3DPreview = dynamic(() => import("./Product3DPreview"), {
  ssr: false,
  loading: () => <div className="w-full h-60 flex items-center justify-center text-sm text-gray-400 bg-gray-50 rounded-2xl">Indlæser 3D-model…</div>,
});

// Distinct preview colours per zone (when not highlighting a specific one).
const PALETTE = ["#7c3aed", "#ec4899", "#f59e0b", "#10b981", "#3b82f6", "#ef4444", "#14b8a6", "#a855f7"];

type Slot = { id: string; label: string };

export default function ZoneMapper({
  productId, version, slots, value, onChange,
}: {
  productId: string;
  version?: string;
  slots: Slot[];
  value: ColorZone[];
  onChange: (zones: ColorZone[]) => void;
}) {
  const [zoneKeys, setZoneKeys] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    setZoneKeys(null);
    fetch(`/api/products/${productId}/mesh${version ? `?v=${encodeURIComponent(version)}` : ""}`)
      .then((r) => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
      .then((m: { zones: { key: string }[] }) => {
        if (!alive) return;
        const keys = m.zones.map((z) => z.key);
        setZoneKeys(keys);
        // Auto-suggest a mapping if missing or out of sync with the model.
        const inSync = value.length === keys.length && keys.every((k) => value.some((v) => v.key === k));
        if (!inSync && slots.length) {
          onChange(keys.map((k, i) => ({ key: k, slotId: slots[i % slots.length].id })));
        }
      })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId, version]);

  const zoneColors: Record<string, string> = {};
  (zoneKeys ?? []).forEach((k, i) => { zoneColors[k] = PALETTE[i % PALETTE.length]; });

  function setZoneSlot(key: string, slotId: string) {
    const next = (zoneKeys ?? []).map((k) => {
      const existing = value.find((v) => v.key === k);
      return k === key ? { key: k, slotId } : (existing ?? { key: k, slotId: slots[0]?.id ?? "" });
    });
    onChange(next);
  }

  if (error) {
    return <p className="text-xs text-gray-400 italic">Kunne ikke læse 3D-zoner ({error}). Gem produktet med modelfilen først, og prøv igen.</p>;
  }
  if (!slots.length) {
    return <p className="text-xs text-amber-600">Tilføj farveområder ovenfor for at kunne mappe modellens zoner.</p>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Product3DPreview
        productId={productId}
        version={version}
        zoneColors={zoneColors}
        highlightZone={focused}
        className="w-full h-60 rounded-2xl bg-gray-50 border border-gray-100 overflow-hidden"
      />
      <div className="flex flex-col gap-2">
        {!zoneKeys ? (
          <p className="text-xs text-gray-400">Finder farvezoner…</p>
        ) : (
          zoneKeys.map((key, i) => {
            const mapped = value.find((v) => v.key === key)?.slotId ?? "";
            return (
              <div
                key={key}
                onMouseEnter={() => setFocused(key)}
                onMouseLeave={() => setFocused(null)}
                className="flex items-center gap-2 p-2 rounded-xl border border-gray-100 hover:border-purple-300 transition-colors"
              >
                <span className="w-4 h-4 rounded-full flex-shrink-0 border border-gray-200" style={{ backgroundColor: PALETTE[i % PALETTE.length] }} />
                <span className="text-sm text-gray-600 flex-shrink-0">Zone {i + 1}</span>
                <span className="text-xs text-gray-300 font-mono">({key})</span>
                <select
                  value={mapped}
                  onChange={(e) => setZoneSlot(key, e.target.value)}
                  className="ml-auto border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
                >
                  {slots.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </div>
            );
          })
        )}
        <p className="text-[11px] text-gray-400 mt-1">Hold musen over en zone for at se den fremhævet i 3D.</p>
      </div>
    </div>
  );
}
