import { FilamentSpool } from "./settings";
import { MAX_LINES, splitTextLines } from "./textpaths";
export { MAX_LINES, splitTextLines, joinTextLines } from "./textpaths";

// ─── Types ───────────────────────────────────────────────────────────────────

export type KeyringSizeOption = {
  id: string;        // "small" | "medium" | "large"
  label: string;     // "Lille", "Mellem", "Stor"
  /**
   * The advertised size: the height of a capital letter, in mm. This is what the
   * customer is promised and what makes the sizes comparable — the plate simply grows
   * around the text, so a short name gives a short keyring and a long name a long one,
   * with identical lettering. (Plate width/height can't be advertised meaningfully:
   * name lengths vary far too much.)
   */
  textHeightMm: number;
  widthMm: number;   // plate size for the template shapes (heart/oval) only
  heightMm: number;  // plate size for the template shapes (heart/oval) only
  basePrice: number; // i øre, fx 5900
};

export type KeyringSettings = {
  enabled: boolean;
  sizes: KeyringSizeOption[];
};

export type KeyringConfig = {
  text: string;
  font: string;          // "Roboto-Bold" | "Pacifico-Regular" | "BebasNeue-Regular"
  shapeType: "auto" | "heart" | "oval" | "round" | "star";
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
  // Always 2-colour; basePrice is the all-in price (no separate surcharge).
  sizes: [
    { id: "small",  label: "Lille",  textHeightMm: 10, widthMm: 45, heightMm: 20, basePrice: 7900 },
    { id: "medium", label: "Mellem", textHeightMm: 14, widthMm: 60, heightMm: 28, basePrice: 9900 },
    { id: "large",  label: "Stor",   textHeightMm: 18, widthMm: 80, heightMm: 35, basePrice: 11900 },
  ],
};

/**
 * Capital-letter height as a fraction of the font's em size, measured from the actual
 * font files. Lets a given `textHeightMm` render the same visual letter size in every
 * font (Pacifico's capitals fill much more of the em than Roboto's or Bebas Neue's).
 */
const CAP_HEIGHT_RATIO: Record<string, number> = {
  "Roboto-Bold": 0.711,
  "BebasNeue-Regular": 0.700,
  "Pacifico-Regular": 0.884,
};

/** Longest name we accept. This alone bounds the keyring's length — text is never
 *  scaled down to fit, so the lettering is always exactly the advertised size. */
export const MAX_TEXT_LENGTH = 15;

/**
 * The size's capital-letter height. Sizes saved before this field existed derive it
 * from their old plate height, which reproduces the intended 10/14/18mm — so stored
 * settings keep showing three genuinely different sizes without a migration step.
 */
export function capHeightOf(size: KeyringSizeOption): number {
  return size.textHeightMm && size.textHeightMm > 0
    ? size.textHeightMm
    : Math.max(6, (size.heightMm || 28) * 0.5);
}

/** Rough average glyph advance as a fraction of the em size — for length estimates. */
const CHAR_WIDTH_RATIO: Record<string, number> = {
  "Roboto-Bold": 0.58,
  "Pacifico-Regular": 0.62,
  "BebasNeue-Regular": 0.42, // condensed
};

export const KEYRING_FONTS = [
  { id: "Roboto-Bold",       label: "Roboto",      cssFamily: "Roboto, sans-serif",   description: "Klar og læsbar" },
  { id: "Pacifico-Regular",  label: "Pacifico",    cssFamily: "Pacifico, cursive",    description: "Sjov og rund" },
  { id: "BebasNeue-Regular", label: "Bebas Neue",  cssFamily: "'Bebas Neue', sans-serif", description: "Fed og kompakt" },
];

// Hjerte er stadig skjult i shoppen — ikke klar til produktion endnu (geometrien
// i getShapePolygon()/buildKeyringMesh() understøtter den stadig, så det er kun
// kunde-valget der er slået fra). Tilføj { id: "heart", ... } her for at genaktivere.
export const KEYRING_SHAPES = [
  { id: "auto",  label: "Automatisk", description: "Tilpasses teksten" },
  { id: "oval",  label: "Oval",       description: "Oval med øje" },
  { id: "round", label: "Rund",       description: "Rund med hul" },
];

export const KEYRING_HOLE_POSITIONS = [
  { id: "top",  label: "Øverst",  description: "Hullet sidder over teksten" },
  { id: "side", label: "I siden", description: "Hullet sidder til venstre for teksten" },
];

/**
 * A round tag has no sensible side eye — the hole belongs at the top, where it
 * leaves the disc symmetric around the lettering.
 */
export function holePositionsFor(shapeType: string) {
  return shapeType === "round"
    ? KEYRING_HOLE_POSITIONS.filter((p) => p.id === "top")
    : KEYRING_HOLE_POSITIONS;
}

// ─── Price calculation ────────────────────────────────────────────────────────

// Keyrings are always 2-colour now, so the price is simply the size's (all-in) price.
export function calcPrice(size: KeyringSizeOption): number {
  return size.basePrice;
}

// ─── Font size calculation ────────────────────────────────────────────────────

/**
 * The font size (em, in mm) that renders capitals at the size's advertised
 * `textHeightMm`. Deliberately independent of the text: every name gets identical
 * lettering, and the keyring simply gets longer or shorter to suit.
 */
export function calcFontSize(
  text: string,
  fontId: string,
  size: KeyringSizeOption
): number | null {
  if (!text) return null;
  const ratio = CAP_HEIGHT_RATIO[fontId] ?? 0.711;
  return Math.round((lineCapHeight(text, size) / ratio) * 10) / 10;
}

/**
 * The size a customer picks means LETTER height, not plate size — that is the whole
 * point of naming the sizes after the text. So a second line must not shrink the
 * lettering down to fit the old plate; it keeps most of its height and the keyring
 * grows instead. Squeezing two lines into a Lille plate was what made Lille unusable:
 * 3.7mm letters with a 1.1mm gap between colours.
 *
 * Not the FULL height, though — two lines at full size would make a Lille bigger
 * than a Mellem, which is absurd to sell. This ratio and TWO_LINE_PLATE_GROWTH split
 * the difference between them.
 */
export const TWO_LINE_CAP_RATIO = 0.65;

/** How much taller a template plate gets when the text has two lines. */
export const TWO_LINE_PLATE_GROWTH = 1.28;

/** Cap height of ONE line of the given text. */
export function lineCapHeight(text: string, size: KeyringSizeOption): number {
  const lines = Math.max(1, splitTextLines(text).length);
  return lines > 1 ? capHeightOf(size) * TWO_LINE_CAP_RATIO : capHeightOf(size);
}

/**
 * The plate a fixed-shape template needs for this text. Only the height grows: a
 * second line adds rows, not length, and the round tag derives its diameter from
 * the height so it grows with it.
 */
export function plateSizeFor(
  size: KeyringSizeOption,
  lineCount: number
): KeyringSizeOption {
  if (lineCount <= 1) return size;
  return { ...size, heightMm: size.heightMm * TWO_LINE_PLATE_GROWTH };
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

  const lines = splitTextLines(config.text);
  if (lines.length > MAX_LINES) {
    return { ok: false, error: `Maks. ${MAX_LINES} linjer` };
  }
  // Per line, not in total: the limit exists to bound how LONG the keyring gets,
  // and a second line adds height rather than length.
  const tooLong = lines.find((l) => l.length > MAX_TEXT_LENGTH);
  if (tooLong) {
    return { ok: false, error: `Maks. ${MAX_TEXT_LENGTH} tegn pr. linje` };
  }

  if (!size) {
    return { ok: false, error: "Vælg en størrelse" };
  }

  const fontSize = calcFontSize(config.text, config.font, size) ?? 0;

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

  // Template shapes have a fixed plate, so short text can look lost on it. ("auto"
  // needs no length check — the character limit already bounds the keyring's length.)
  if (config.shapeType !== "auto") {
    const ratio = CHAR_WIDTH_RATIO[config.font] ?? 0.58;
    const longest = lines.reduce((n, l) => Math.max(n, l.length), 0);
    const textWidth = fontSize * ratio * longest;
    // Measure the plate itself rather than assuming it spans widthMm — a round tag
    // is far narrower than the size preset's width.
    const grown = plateSizeFor(size, lines.length);
    const plate = getShapePolygon(config.shapeType, grown.widthMm, grown.heightMm);
    const xs = plate.map((p) => p.x);
    const plateWidth = Math.max(...xs) - Math.min(...xs);
    if (textWidth / Math.max(1, plateWidth - 10) < 0.3) {
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

/** Round tags read best a bit larger than the oval's height — see getShapePolygon. */
const ROUND_DIAMETER_FACTOR = 1.45;

/** True when this template hangs its ring hole off an external tab, like "auto"
 *  does, instead of punching it through the plate itself. */
export function templateUsesTab(shapeType: string): boolean {
  return shapeType === "oval";
}

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

  if (shapeType === "round") {
    // The size presets are elongated (45×20 … 80×35), so neither dimension is a
    // sensible diameter on its own: the width would give a huge medallion and the
    // height a rather mean little disc. Scaling the height lands Lille/Mellem/Stor
    // at ~29/41/51 mm — the range real round key tags come in.
    const r = (heightMm * ROUND_DIAMETER_FACTOR) / 2;
    const pts: Point[] = [];
    for (let i = 0; i < steps; i++) {
      const t = (i / steps) * 2 * Math.PI;
      pts.push({ x: r * Math.cos(t), y: r * Math.sin(t) });
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
