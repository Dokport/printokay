"use client";

import { useEffect, useRef, useState } from "react";
import { useCart } from "@/lib/cartContext";
import { KEYRING_FONTS, KEYRING_SHAPES, calcFontSize, calcPrice, validateConfig } from "@/lib/keyring";
import type { KeyringSizeOption, KeyringSettings } from "@/lib/keyring";
import type { FilamentSpool } from "@/lib/settings";
import { DEFAULT_KEYRING_SETTINGS } from "@/lib/keyring";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

type Settings = {
  primaryColor: string;
  keyring: KeyringSettings;
  filaments: FilamentSpool[];
};

// ─── Canvas preview ───────────────────────────────────────────────────────────

function KeyringPreview({
  text,
  font,
  shapeType,
  size,
  baseColor,
  textColor,
}: {
  text: string;
  font: string;
  shapeType: string;
  size: KeyringSizeOption | null;
  baseColor: string;
  textColor: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    if (!size) {
      ctx.fillStyle = "#f3f4f6";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#9ca3af";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Vælg en størrelse", W / 2, H / 2);
      return;
    }

    // Scale: fit the keyring nicely in canvas
    const scale = Math.min((W - 40) / size.widthMm, (H - 40) / size.heightMm);
    const kw = size.widthMm * scale;
    const kh = size.heightMm * scale;
    const cx = W / 2;
    const cy = H / 2;

    // Draw background
    ctx.fillStyle = "#f9fafb";
    ctx.fillRect(0, 0, W, H);

    // Draw keyring shape
    ctx.save();
    ctx.translate(cx, cy);

    const drawShape = () => {
      ctx.beginPath();
      if (shapeType === "oval") {
        ctx.ellipse(0, 0, kw / 2, kh / 2, 0, 0, Math.PI * 2);
      } else if (shapeType === "heart") {
        // Simplified heart using bezier curves
        const hw = kw / 2;
        const hh = kh / 2;
        ctx.moveTo(0, hh * 0.5);
        ctx.bezierCurveTo(-hw * 0.1, hh * 0.9, -hw * 1.1, hh * 0.6, -hw, 0);
        ctx.bezierCurveTo(-hw, -hh * 0.8, 0, -hh * 0.6, 0, -hh * 0.2);
        ctx.bezierCurveTo(0, -hh * 0.6, hw, -hh * 0.8, hw, 0);
        ctx.bezierCurveTo(hw * 1.1, hh * 0.6, hw * 0.1, hh * 0.9, 0, hh * 0.5);
      } else {
        // Rounded rectangle (auto)
        const r = Math.min(kw, kh) * 0.15;
        ctx.roundRect(-kw / 2, -kh / 2, kw, kh, r);
      }
    };

    // Fill base color
    drawShape();
    ctx.fillStyle = baseColor || "#888888";
    ctx.fill();

    // Subtle shadow/border
    drawShape();
    ctx.strokeStyle = "rgba(0,0,0,0.2)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw keyring hole
    const holeRadius = 4 * scale;
    const holeCy = -(kh / 2 - holeRadius - 2 * scale);
    ctx.beginPath();
    ctx.arc(0, holeCy, holeRadius, 0, Math.PI * 2);
    ctx.fillStyle = "#f9fafb";
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.2)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Draw text
    if (text) {
      const fontFamily = KEYRING_FONTS.find((f) => f.id === font)?.cssFamily ?? "sans-serif";
      const fontSize = calcFontSize(text, font, size);
      if (fontSize) {
        const fontPx = fontSize * scale;
        ctx.font = `${fontPx}px ${fontFamily}`;
        ctx.fillStyle = textColor || "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        // Clip to shape for text
        drawShape();
        ctx.clip();

        // Position text below the hole
        const textY = holeRadius * 2 + 2 * scale + fontPx / 2 - kh / 2 + 4 * scale;
        ctx.fillText(text, 0, textY > 0 ? textY : fontPx / 4);
      }
    }

    ctx.restore();
  }, [text, font, shapeType, size, baseColor, textColor]);

  return (
    <canvas
      ref={canvasRef}
      width={480}
      height={280}
      className="w-full rounded-2xl bg-gray-50 border border-gray-100"
      style={{ maxHeight: 280 }}
    />
  );
}

// ─── Filament dropdown ────────────────────────────────────────────────────────

function FilamentDropdown({
  label,
  value,
  onChange,
  filaments,
  primaryColor,
  excludeId,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  filaments: FilamentSpool[];
  primaryColor: string;
  excludeId?: string;
}) {
  const [open, setOpen] = useState(false);
  const chosen = filaments.find((f) => f.id === value);
  const available = filaments.filter((f) => f.inStock && f.id !== excludeId);

  return (
    <div className="relative">
      <p className="text-xs font-medium text-gray-500 mb-1">{label}</p>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-sm bg-white transition-colors"
        style={{ borderColor: open ? primaryColor : "#e5e7eb" }}
      >
        {chosen ? (
          <span className="flex items-center gap-2">
            <span
              className="w-4 h-4 rounded-full flex-shrink-0 border border-gray-200"
              style={{ backgroundColor: chosen.colorHex }}
            />
            <span className="font-medium text-gray-700">{chosen.name}</span>
            <span className="text-gray-400 text-xs font-mono">{chosen.material}</span>
          </span>
        ) : (
          <span className="text-gray-400">Vælg filament...</span>
        )}
        <span className="text-gray-400 text-xs">{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg z-30 max-h-48 overflow-y-auto">
          {available.length === 0 ? (
            <p className="px-3 py-3 text-sm text-gray-400">Ingen filament på lager</p>
          ) : (
            available.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => { onChange(f.id); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 transition-colors"
                style={{ backgroundColor: value === f.id ? `color-mix(in srgb, ${primaryColor} 8%, white)` : undefined }}
              >
                <span className="w-4 h-4 rounded-full flex-shrink-0 border border-gray-200"
                  style={{ backgroundColor: f.colorHex }} />
                <span className="font-medium text-gray-700 flex-1 text-left">{f.name}</span>
                <span className="text-gray-400 text-xs font-mono">{f.material}</span>
                {value === f.id && <span style={{ color: primaryColor }}>✓</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function NøgleringPage() {
  const { addItem } = useCart();

  const [settings, setSettings] = useState<Settings>({
    primaryColor: DEFAULT_SETTINGS.primaryColor,
    keyring: DEFAULT_KEYRING_SETTINGS,
    filaments: DEFAULT_SETTINGS.filaments,
  });

  // Config state
  const [text, setText] = useState("");
  const [font, setFont] = useState(KEYRING_FONTS[0].id);
  const [shapeType, setShapeType] = useState<"auto" | "heart" | "oval">("auto");
  const [sizeId, setSizeId] = useState<string | null>(null);
  const [baseFilamentId, setBaseFilamentId] = useState("");
  const [textFilamentId, setTextFilamentId] = useState("");
  const [added, setAdded] = useState(false);

  useEffect(() => {
    // Load Google fonts for canvas
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "https://fonts.googleapis.com/css2?family=Roboto:wght@700&family=Pacifico&family=Bebas+Neue&display=swap";
    document.head.appendChild(link);

    // Fetch settings
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setSettings({
          primaryColor: data.primaryColor ?? DEFAULT_SETTINGS.primaryColor,
          keyring: data.keyring ?? DEFAULT_KEYRING_SETTINGS,
          filaments: data.filaments ?? [],
        });
      })
      .catch(() => {});
  }, []);

  const { primaryColor, keyring, filaments } = settings;
  const sizes = keyring.sizes ?? DEFAULT_KEYRING_SETTINGS.sizes;
  const surcharge = keyring.twoColorSurcharge ?? 2000;
  const inStockFilaments = filaments.filter((f) => f.inStock);

  const selectedSize = sizes.find((s) => s.id === sizeId) ?? null;
  const baseFil = filaments.find((f) => f.id === baseFilamentId);
  const textFil = filaments.find((f) => f.id === textFilamentId);
  const twoColors = !!(baseFilamentId && textFilamentId && baseFilamentId !== textFilamentId);
  const price = selectedSize ? calcPrice(selectedSize, twoColors, surcharge) : null;

  const validation = validateConfig(
    {
      text, font, shapeType,
      sizeId: sizeId ?? "",
      baseFilamentId,
      textFilamentId,
      fontSize: selectedSize ? (calcFontSize(text, font, selectedSize) ?? 0) : 0,
    },
    selectedSize ?? undefined,
    filaments
  );

  const fontSize = selectedSize ? calcFontSize(text, font, selectedSize) : null;

  function handleAddToCart() {
    if (!validation.ok || !selectedSize || !price || !baseFil || !textFil || !fontSize) return;

    // Virtual "Nøglering" product
    const keyringProduct = {
      id: "noglering",
      name: "Custom Nøglering",
      description: `"${text}" — ${selectedSize.label}`,
      price,
      image: "",
      emoji: "🔑",
      category: "noglering",
      material: "PLA",
      modelUrl: "",
      colorSlots: [],
    };

    addItem(keyringProduct, {
      keyringData: {
        text,
        font,
        shapeType,
        sizeId: selectedSize.id,
        sizeLabel: selectedSize.label,
        baseFilamentId,
        baseFilamentName: baseFil.name,
        baseColorHex: baseFil.colorHex,
        textFilamentId,
        textFilamentName: textFil.name,
        textColorHex: textFil.colorHex,
        fontSize,
        price,
      },
    });

    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">🔑 Custom Nøglering</h1>
        <p className="text-gray-500">
          Design din egen nøglering — vælg tekst, font, form og farver, og vi 3D-printer den til dig!
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* ── Left: Configuration ── */}
        <div className="flex flex-col gap-5">

          {/* Text input */}
          <div>
            <label className="text-sm font-semibold text-gray-700 mb-1.5 block">
              Tekst på nøgleringen
            </label>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Skriv din tekst her..."
              maxLength={20}
              className="w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 text-gray-800 text-base"
              style={{ "--tw-ring-color": primaryColor } as React.CSSProperties}
            />
            <p className="text-xs text-gray-400 mt-1">{text.length}/20 tegn</p>
          </div>

          {/* Size selector */}
          <div>
            <label className="text-sm font-semibold text-gray-700 mb-2 block">Størrelse</label>
            <div className="grid grid-cols-3 gap-2">
              {sizes.map((size) => {
                const sizePrice = calcPrice(size, twoColors, surcharge);
                const isSelected = sizeId === size.id;
                return (
                  <button
                    key={size.id}
                    type="button"
                    onClick={() => setSizeId(size.id)}
                    className="flex flex-col items-center gap-0.5 p-3 rounded-xl border-2 transition-all text-center"
                    style={{
                      borderColor: isSelected ? primaryColor : "#e5e7eb",
                      backgroundColor: isSelected ? `color-mix(in srgb, ${primaryColor} 8%, white)` : "white",
                    }}
                  >
                    <span className="font-bold text-sm" style={{ color: isSelected ? primaryColor : "#374151" }}>
                      {size.label}
                    </span>
                    <span className="text-xs text-gray-400">{size.widthMm}×{size.heightMm}mm</span>
                    <span className="text-xs font-semibold mt-1" style={{ color: primaryColor }}>
                      {(size.basePrice / 100).toFixed(0)} kr
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Font selector */}
          <div>
            <label className="text-sm font-semibold text-gray-700 mb-2 block">Skrifttype</label>
            <div className="grid grid-cols-3 gap-2">
              {KEYRING_FONTS.map((f) => {
                const isSelected = font === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFont(f.id)}
                    className="flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all"
                    style={{
                      borderColor: isSelected ? primaryColor : "#e5e7eb",
                      backgroundColor: isSelected ? `color-mix(in srgb, ${primaryColor} 8%, white)` : "white",
                    }}
                  >
                    <span style={{ fontFamily: f.cssFamily, fontSize: 16, color: isSelected ? primaryColor : "#374151" }}>
                      Abc
                    </span>
                    <span className="text-xs text-gray-500">{f.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Shape selector */}
          <div>
            <label className="text-sm font-semibold text-gray-700 mb-2 block">Formskabelon</label>
            <div className="flex gap-2">
              {KEYRING_SHAPES.map((s) => {
                const isSelected = shapeType === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setShapeType(s.id as "auto" | "heart" | "oval")}
                    className="flex flex-col items-center gap-1 flex-1 py-2.5 rounded-xl border-2 transition-all"
                    style={{
                      borderColor: isSelected ? primaryColor : "#e5e7eb",
                      backgroundColor: isSelected ? `color-mix(in srgb, ${primaryColor} 8%, white)` : "white",
                    }}
                  >
                    <span className="text-xl">{s.emoji}</span>
                    <span className="text-xs" style={{ color: isSelected ? primaryColor : "#6b7280" }}>{s.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Color selection */}
          {inStockFilaments.length > 0 ? (
            <div className="flex flex-col gap-3">
              <label className="text-sm font-semibold text-gray-700">Farver</label>
              <FilamentDropdown
                label="Basis-farve (nøglering)"
                value={baseFilamentId}
                onChange={setBaseFilamentId}
                filaments={inStockFilaments}
                primaryColor={primaryColor}
                excludeId={textFilamentId}
              />
              <FilamentDropdown
                label="Tekst-farve (bogstaver)"
                value={textFilamentId}
                onChange={setTextFilamentId}
                filaments={inStockFilaments}
                primaryColor={primaryColor}
                excludeId={baseFilamentId}
              />
              {baseFilamentId && textFilamentId && baseFilamentId === textFilamentId && (
                <p className="text-xs text-amber-600 font-medium">
                  ⚠️ Basis og tekst-farve er ens — vælg to forskellige farver for 2-farve print
                </p>
              )}
            </div>
          ) : (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-700">
              Ingen filament på lager i øjeblikket — kontakt os for specialbestilling.
            </div>
          )}
        </div>

        {/* ── Right: Preview + Price ── */}
        <div className="flex flex-col gap-4">
          <label className="text-sm font-semibold text-gray-700">Forhåndsvisning</label>

          <KeyringPreview
            text={text}
            font={font}
            shapeType={shapeType}
            size={selectedSize}
            baseColor={baseFil?.colorHex ?? "#7c3aed"}
            textColor={textFil?.colorHex ?? "#ffffff"}
          />

          {/* Validation messages */}
          {!validation.ok && text && (
            <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              ❌ {validation.error}
            </div>
          )}
          {validation.ok && validation.warning && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-700">
              ⚠️ {validation.warning}
            </div>
          )}

          {/* Price breakdown */}
          {selectedSize && (
            <div className="rounded-2xl border border-gray-100 bg-white p-4 flex flex-col gap-1.5">
              <div className="flex justify-between text-sm text-gray-600">
                <span>Basispris ({selectedSize.label})</span>
                <span>{(selectedSize.basePrice / 100).toFixed(0)} kr</span>
              </div>
              {twoColors && (
                <div className="flex justify-between text-sm text-gray-600">
                  <span>2-farve tillæg</span>
                  <span>+{(surcharge / 100).toFixed(0)} kr</span>
                </div>
              )}
              <div className="border-t border-gray-100 mt-1 pt-2 flex justify-between font-bold text-base" style={{ color: primaryColor }}>
                <span>I alt</span>
                <span>{price ? `${(price / 100).toFixed(0)} kr` : "—"}</span>
              </div>
            </div>
          )}

          {/* Add to cart */}
          <button
            onClick={handleAddToCart}
            disabled={!validation.ok || !baseFilamentId || !textFilamentId || baseFilamentId === textFilamentId}
            className="w-full py-3.5 rounded-2xl font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed text-base"
            style={{ backgroundColor: added ? "#22c55e" : primaryColor }}
          >
            {added ? "✓ Lagt i kurv!" : `🔑 Læg i kurv${price ? ` — ${(price / 100).toFixed(0)} kr` : ""}`}
          </button>

          {added && (
            <Link
              href="/kurv"
              className="text-center text-sm font-medium transition-colors"
              style={{ color: primaryColor }}
            >
              Se kurv →
            </Link>
          )}

          {/* Info box */}
          <div className="rounded-xl bg-gray-50 p-4 text-xs text-gray-500 flex flex-col gap-1">
            <p>🖨️ Printet i <strong>PLA</strong> på Bambu Lab X1 Carbon</p>
            <p>📐 Teksten tilpasses automatisk til den valgte størrelse</p>
            <p>🎨 2 farver via automatisk filamentskift</p>
            <p>⏱️ Leveringstid: se fragtvalg ved checkout</p>
          </div>
        </div>
      </div>
    </div>
  );
}
