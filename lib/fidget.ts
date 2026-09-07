/**
 * Custom fidget clicker: a box of real Cherry-MX switches with printed caps.
 *
 * The customer picks a grid of switches, three colours (box, caps, text) and up to
 * three characters per cap. The shop prints box, lid and every cap on one plate as
 * one Bambu 3MF, fits the switches, and ships it assembled. The switch type is ours
 * to choose — it is a stock decision, not a design one.
 */
import type { FilamentSpool } from "./settings";
import { splitTextLines } from "./textpaths";

export const FIDGET_FONT = "Roboto-Bold";
export const MAX_COLS = 4;
export const MAX_ROWS = 2;
export const MAX_CAP_CHARS = 3;

/**
 * What the cap fields start out saying.
 *
 * An empty grid of little boxes does not explain itself — a customer has to guess
 * that they are for text, and that a word of two or three letters fits. Filling
 * them in shows both at once, and the preview then has something written on it from
 * the first moment. Each field clears on first focus, so nobody orders the example
 * by accident.
 */
export const EXAMPLE_LABELS = ["JA", "NEJ", "OK", "HEY", "GO", "NU", "TAK", "WOW"];

export function exampleLabel(index: number): string {
  return EXAMPLE_LABELS[index % EXAMPLE_LABELS.length];
}

export type FidgetConfig = {
  cols: number;              // 1..MAX_COLS
  rows: number;              // 1..MAX_ROWS
  /** One entry per switch, row-major (top row first, left to right). "" = blank cap. */
  labels: string[];
  /** Adds a lug with a 5mm hole to the box, so it can hang on a keychain. */
  keyring?: boolean;
  boxFilamentId: string;     // box + lid
  capFilamentId: string;
  textFilamentId: string;
};

export type FidgetSettings = {
  /**
   * Whether the shop offers the product at all.
   *
   * Off by default: a made-to-order product that has not been printed and fitted
   * yet should not be orderable, and a new field arriving in the code must not
   * quietly put something on sale.
   */
  enabled: boolean;
  basePrice: number;         // øre — box, lid, assembly
  pricePerSwitch: number;    // øre — switch, cap, print
  switchLabel: string;       // what we fit, shown to the customer ("Klik (blå)")
  /**
   * Which filaments this product is offered in, by id.
   *
   * Not simply everything in stock: the plate prints in three colours at once, so
   * what can be chosen is what is loaded in the AMS — a shop decision, not a
   * stock-wide one. Empty falls back to whatever is in stock, so the product still
   * works before anyone has picked.
   */
  filamentIds: string[];
  /**
   * Width of the cross slot in the caps, in mm. A property of the printer rather
   * than the switch — a slot this size closes up on an FDM machine — so it is
   * calibrated from a test print and kept here.
   */
  crossWidthMm: number;
  /** Surcharge for the keyring eye, in øre — it costs a split ring and some plastic. */
  keyringPrice: number;
};

export const DEFAULT_FIDGET_SETTINGS: FidgetSettings = {
  enabled: false,
  basePrice: 9900,
  pricePerSwitch: 2500,
  switchLabel: "Klik-switch",
  crossWidthMm: 1.35,
  keyringPrice: 1500,
  filamentIds: [],
};

export function switchCount(cfg: Pick<FidgetConfig, "cols" | "rows">): number {
  return cfg.cols * cfg.rows;
}

export function calcFidgetPrice(
  cfg: Pick<FidgetConfig, "cols" | "rows" | "keyring">,
  s: FidgetSettings
): number {
  return s.basePrice + switchCount(cfg) * s.pricePerSwitch + (cfg.keyring ? s.keyringPrice : 0);
}

/**
 * Labels padded/truncated to the grid, upper-cased, each trimmed to the cap's
 * character limit.
 *
 * Upper-casing here rather than in the input's CSS: `text-transform` only changes
 * what the field looks like, so a lower-case letter reached the cap and the printed
 * key did not match what the customer had been shown.
 */
export function normalizeLabels(cfg: FidgetConfig): string[] {
  const n = switchCount(cfg);
  return Array.from({ length: n }, (_, i) =>
    (splitTextLines(cfg.labels[i] ?? "")[0] ?? "").toLocaleUpperCase("da-DK").slice(0, MAX_CAP_CHARS)
  );
}

export type FidgetValidation = { ok: boolean; error?: string };

/** The filaments this product may be ordered in, in stock order. */
export function fidgetFilaments(
  settings: Pick<FidgetSettings, "filamentIds">,
  filaments: FilamentSpool[]
): FilamentSpool[] {
  const inStock = filaments.filter((f) => f.inStock && f.material === "PLA");
  const chosen = settings.filamentIds ?? [];
  if (!chosen.length) return inStock;
  return inStock.filter((f) => chosen.includes(f.id));
}

export function validateFidget(
  cfg: FidgetConfig,
  filaments: FilamentSpool[],
  settings: Pick<FidgetSettings, "filamentIds"> = { filamentIds: [] }
): FidgetValidation {
  if (!Number.isInteger(cfg.cols) || cfg.cols < 1 || cfg.cols > MAX_COLS) {
    return { ok: false, error: `Vælg 1–${MAX_COLS} kolonner` };
  }
  if (!Number.isInteger(cfg.rows) || cfg.rows < 1 || cfg.rows > MAX_ROWS) {
    return { ok: false, error: `Vælg 1–${MAX_ROWS} rækker` };
  }
  const tooLong = (cfg.labels ?? []).find((l) => (l ?? "").trim().length > MAX_CAP_CHARS);
  if (tooLong !== undefined) {
    return { ok: false, error: `Maks. ${MAX_CAP_CHARS} tegn pr. knap` };
  }
  const offered = new Set(fidgetFilaments(settings, filaments).map((f) => f.id));
  for (const [id, what] of [
    [cfg.boxFilamentId, "kasse"], [cfg.capFilamentId, "knapper"], [cfg.textFilamentId, "tekst"],
  ] as const) {
    if (!id) return { ok: false, error: `Vælg en farve til ${what}` };
    if (!offered.has(id)) return { ok: false, error: `Farven til ${what} kan ikke vælges` };
  }
  if (cfg.capFilamentId === cfg.textFilamentId) {
    return { ok: false, error: "Tekst og knap skal have hver sin farve" };
  }
  return { ok: true };
}
