import { FilamentSpool } from "./settings";

// ─── Types ───────────────────────────────────────────────────────────────────

export type KeyringSizeOption = {
  id: string;        // "small" | "medium" | "large"
  label: string;     // "Lille", "Mellem", "Stor"
  widthMm: number;
  heightMm: number;
  basePrice: number; // i øre, fx 5900
};

export type KeyringSettings = {
  enabled: boolean;
  sizes: KeyringSizeOption[];
  twoColorSurcharge: number; // i øre, fx 2000
};

export type KeyringConfig = {
  text: string;
  font: string;          // "Roboto-Bold" | "Pacifico-Regular" | "BebasNeue-Regular"
  shapeType: "auto" | "heart" | "oval" | "star";
  holePosition: "top" | "side"; // "top" = tab above text, "side" = tab left of text
  sizeId: string;        // refers to KeyringSizeOption.id
  baseFilamentId: string;
  textFilamentId: string;
  fontSize: number;      // auto-calculated based on size + text length
};

export type ValidationResult = {
  ok: boolean;
  error?: string;   // blocking — disables "add to cart"
  warning?: string; // non-blocking warning shown to user
};

// ─── Defaults ────────────────────────────────────────────────────────────────

export const DEFAULT_KEYRING_SETTINGS: KeyringSettings = {
  enabled: true,
  sizes: [
    { id: "small",  label: "Lille",  widthMm: 45, heightMm: 20, basePrice: 5900 },
    { id: "medium", label: "Mellem", widthMm: 60, heightMm: 28, basePrice: 7900 },
    { id: "large",  label: "Stor",   widthMm: 80, heightMm: 35, basePrice: 9900 },
  ],
  twoColorSurcharge: 2000,
};

export const KEYRING_FONTS = [
  { id: "Roboto-Bold",       label: "Roboto",      cssFamily: "Roboto, sans-serif",   description: "Klar og læsbar" },
  { id: "Pacifico-Regular",  label: "Pacifico",    cssFamily: "Pacifico, cursive",    description: "Sjov og rund" },
  { id: "BebasNeue-Regular", label: "Bebas Neue",  cssFamily: "'Bebas Neue', sans-serif", description: "Fed og kompakt" },
];

export const KEYRING_SHAPES = [
  { id: "auto",  label: "Automatisk", description: "Tilpasses teksten" },
  { id: "heart", label: "Hjerte",     description: "Hjerteform" },
  { id: "oval",  label: "Oval",       description: "Oval form" },
];

export const KEYRING_HOLE_POSITIONS = [
  { id: "top",  label: "Øverst",  description: "Hullet sidder over teksten" },
  { id: "side", label: "I siden", description: "Hullet sidder til venstre for teksten" },
];

// ─── Price calculation ────────────────────────────────────────────────────────

export function calcPrice(
  size: KeyringSizeOption,
  twoColors: boolean,
  surcharge: number
): number {
  return size.basePrice + (twoColors ? surcharge : 0);
}

// ─── Font size calculation ────────────────────────────────────────────────────

/**
 * Calculate the optimal font size (in mm) for the given text and size.
 * Returns null if text cannot fit even at minimum font size.
 */
export function calcFontSize(
  text: string,
  fontId: string,
  size: KeyringSizeOption
): number | null {
  if (!text) return null;

  const maxWidth = size.widthMm - 10; // 5mm margin on each side
  const maxHeight = size.heightMm - 8; // 4mm margin top/bottom

  // Approximate character width ratios per font (width/height ratio per character)
  const charRatios: Record<string, number> = {
    "Roboto-Bold": 0.58,
    "Pacifico-Regular": 0.62,
    "BebasNeue-Regular": 0.42, // condensed font
  };
  const ratio = charRatios[fontId] ?? 0.58;

  // Estimate: totalWidth = fontSize * ratio * charCount
  // Solve for fontSize: fontSize = maxWidth / (ratio * charCount)
  const charCount = text.length || 1;
  let fontSize = maxWidth / (ratio * charCount);

  // Also constrain by height
  fontSize = Math.min(fontSize, maxHeight);

  // Minimum readable size: 6mm
  if (fontSize < 6) return null;

  // Maximum capped at height - keeps proportional
  return Math.round(Math.min(fontSize, maxHeight) * 10) / 10;
}

// ─── Validation ───────────────────────────────────────────────────────────────

export function validateConfig(
  config: KeyringConfig,
  size: KeyringSizeOption | undefined,
  filaments: FilamentSpool[]
): ValidationResult {
  if (!config.text.trim()) {
    return { ok: false, error: "Skriv den tekst der skal på nøgleringen" };
  }

  if (!size) {
    return { ok: false, error: "Vælg en størrelse" };
  }

  const fontSize = calcFontSize(config.text, config.font, size);
  if (fontSize === null) {
    return {
      ok: false,
      error: `Teksten er for lang til denne størrelse — prøv kortere tekst eller vælg en større størrelse`,
    };
  }

  const inStockFilaments = filaments.filter((f) => f.inStock);
  if (inStockFilaments.length === 0) {
    return { ok: false, error: "Ingen filament på lager — kontakt os" };
  }

  if (!config.baseFilamentId) {
    return { ok: false, error: "Vælg en base-farve" };
  }
  if (!config.textFilamentId) {
    return { ok: false, error: "Vælg en tekst-farve" };
  }

  // Warn if text uses very little of shape width (only for template shapes)
  if (config.shapeType !== "auto") {
    const maxWidth = size.widthMm - 10;
    const ratio = { "Roboto-Bold": 0.58, "Pacifico-Regular": 0.62, "BebasNeue-Regular": 0.42 }[config.font] ?? 0.58;
    const textWidth = fontSize * ratio * config.text.length;
    const usedPct = textWidth / maxWidth;
    if (usedPct < 0.3) {
      return {
        ok: true,
        warning: "Teksten vil se lille ud på denne form — prøv en kortere form eller et større format",
      };
    }
  }

  return { ok: true };
}

// ─── Shape polygon generation ─────────────────────────────────────────────────

export type Point = { x: number; y: number };

/**
 * Returns a polygon (array of points in mm) for the given shape type.
 * Origin is center of the shape.
 */
export function getShapePolygon(
  shapeType: string,
  widthMm: number,
  heightMm: number,
  steps = 64
): Point[] {
  const hw = widthMm / 2;
  const hh = heightMm / 2;

  if (shapeType === "heart") {
    // Classic heart parametric. Normalize against its TRUE bounding box and scale
    // UNIFORMLY (preserve aspect) so it reads as a proper heart instead of a
    // stretched blob, then center it on the origin.
    const raw: Point[] = [];
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * 2 * Math.PI;
      const rx = 16 * Math.sin(t) ** 3;
      const ry =
        13 * Math.cos(t) -
        5 * Math.cos(2 * t) -
        2 * Math.cos(3 * t) -
        Math.cos(4 * t);
      raw.push({ x: rx, y: ry }); // y-up: lobes at top, tip at bottom
    }
    let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
    for (const p of raw) {
      if (p.x < mnx) mnx = p.x;
      if (p.x > mxx) mxx = p.x;
      if (p.y < mny) mny = p.y;
      if (p.y > mxy) mxy = p.y;
    }
    const rcx = (mnx + mxx) / 2, rcy = (mny + mxy) / 2;
    // Fit inside widthMm × heightMm, uniform scale (no distortion).
    const s = Math.min(widthMm / (mxx - mnx), heightMm / (mxy - mny));
    return raw.map((p) => ({ x: (p.x - rcx) * s, y: (p.y - rcy) * s }));
  }

  if (shapeType === "oval") {
    const pts: Point[] = [];
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * 2 * Math.PI;
      pts.push({ x: hw * Math.cos(t), y: hh * Math.sin(t) });
    }
    return pts;
  }

  // Default: rounded rectangle ("auto")
  const r = Math.min(hw, hh) * 0.25; // corner radius = 25% of shorter side
  const pts: Point[] = [];
  const corners = [
    { cx: hw - r, cy: -hh + r, startAngle: -Math.PI / 2, endAngle: 0 },
    { cx: hw - r, cy: hh - r, startAngle: 0, endAngle: Math.PI / 2 },
    { cx: -hw + r, cy: hh - r, startAngle: Math.PI / 2, endAngle: Math.PI },
    { cx: -hw + r, cy: -hh + r, startAngle: Math.PI, endAngle: (3 * Math.PI) / 2 },
  ];
  const cornerSteps = Math.floor(steps / 4);
  for (const { cx, cy, startAngle, endAngle } of corners) {
    for (let i = 0; i <= cornerSteps; i++) {
      const t = startAngle + (i / cornerSteps) * (endAngle - startAngle);
      pts.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
    }
  }
  return pts;
}

/**
 * Returns a circle polygon for the keyring hole (center at top).
 * Hole center: (0, -(heightMm/2 - holeRadiusMm - 2))
 */
export function getHoleCircle(heightMm: number, radiusMm = 4, steps = 32): Point[] {
  const cy = -(heightMm / 2 - radiusMm - 2);
  const pts: Point[] = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    pts.push({ x: radiusMm * Math.cos(t), y: cy + radiusMm * Math.sin(t) });
  }
  return pts;
}
