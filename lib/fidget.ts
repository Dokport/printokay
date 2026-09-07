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

export type FidgetConfig = {
  cols: number;              // 1..MAX_COLS
  rows: number;              // 1..MAX_ROWS
  /** One entry per switch, row-major (top row first, left to right). "" = blank cap. */
  labels: string[];
  boxFilamentId: string;     // box + lid
  capFilamentId: string;
  textFilamentId: string;
};

export type FidgetSettings = {
  enabled: boolean;
  basePrice: number;         // øre — box, lid, assembly
  pricePerSwitch: number;    // øre — switch, cap, print
  switchLabel: string;       // what we fit, shown to the customer ("Klik (blå)")
};

export const DEFAULT_FIDGET_SETTINGS: FidgetSettings = {
  enabled: true,
  basePrice: 9900,
  pricePerSwitch: 2500,
  switchLabel: "Klik-switch",
};

export function switchCount(cfg: Pick<FidgetConfig, "cols" | "rows">): number {
  return cfg.cols * cfg.rows;
}

export function calcFidgetPrice(cfg: Pick<FidgetConfig, "cols" | "rows">, s: FidgetSettings): number {
  return s.basePrice + switchCount(cfg) * s.pricePerSwitch;
}

/** Labels padded/truncated to the grid, each trimmed to the cap's character limit. */
export function normalizeLabels(cfg: FidgetConfig): string[] {
  const n = switchCount(cfg);
  return Array.from({ length: n }, (_, i) =>
    (splitTextLines(cfg.labels[i] ?? "")[0] ?? "").slice(0, MAX_CAP_CHARS)
  );
}

export type FidgetValidation = { ok: boolean; error?: string };

export function validateFidget(
  cfg: FidgetConfig,
  filaments: FilamentSpool[]
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
  const inStock = new Set(filaments.filter((f) => f.inStock).map((f) => f.id));
  for (const [id, what] of [
    [cfg.boxFilamentId, "kasse"], [cfg.capFilamentId, "knapper"], [cfg.textFilamentId, "tekst"],
  ] as const) {
    if (!id) return { ok: false, error: `Vælg en farve til ${what}` };
    if (!inStock.has(id)) return { ok: false, error: `Farven til ${what} er ikke på lager` };
  }
  if (cfg.capFilamentId === cfg.textFilamentId) {
    return { ok: false, error: "Tekst og knap skal have hver sin farve" };
  }
  return { ok: true };
}
