export type ColorSlot = {
  id: string;
  label: string; // e.g. "Krop", "Øjne", "Base"
};

// Maps a 3MF paint_color zone (from the model) to a colorSlot the customer picks.
export type ColorZone = {
  key: string;    // paint_color value, or "default" for the base extruder
  slotId: string; // → ColorSlot.id
  color?: string; // the model's intended hex for this zone (for default colour mapping)
};

export type Product = {
  id: string;
  name: string;
  description: string;
  price: number; // in DKK øre (e.g. 4900 = 49 kr)
  image: string;    // primary image (kept for backward compat)
  images?: string[]; // all images incl. primary; if set, takes precedence over image
  emoji: string;
  category: string; // dynamic — defined in settings.json
  material: string; // e.g. "PLA", "PETG", "TPU" — empty string means not specified
  modelUrl: string; // link to 3D model file (e.g. Printables, Thingiverse) — admin only
  colorSlots: ColorSlot[]; // named color areas — empty means no color customization
  printMinutes?: number;   // estimated print time in minutes — admin only
  filamentGrams?: number;  // filament usage in grams — admin only
  materialCost?: number;   // material cost in DKK øre — admin only
  // ── Bambuddy-synkronisering ──
  modelFile?: string;       // blob-sti til projekt-.3mf (mesh → 3D + colorZones)
  printFile?: string;       // blob-sti til sliced .gcode.3mf (print + stats)
  previewModel?: string;    // valgfri poseret/let .3mf til shoppens 3D-visning (samme zoner)
  colorZones?: ColorZone[]; // mapping af modellens paint_color-zoner → colorSlots
  // ── Bambuddy-kobling (sat af sidecaren) ──
  bambuddy?: BambuddyLink;
  statsSource?: "estimate" | "actual"; // estimat fra sliced-fil vs. faktisk fra archive
  printStats?: PrintStats;             // aggregeret print-historik fra projektets archives
  // ── Legacy (udfases) ──
  modelSyncedAt?: string;
  bambuddyId?: string;
  bambuddyStatsAt?: string;
};

export type BambuddyLink = {
  projectId?: string;     // Bambuddy project (containeren for produktet)
  folderId?: string;      // linket library-mappe
  projectFileId?: string; // projekt-filens id i Bambuddy
  printFileId?: string;   // sliced-filens id i Bambuddy (print + stats)
  syncedAt?: string;      // ISO-tid: filer + project oprettet i Bambuddy
};

export type PrintStats = {
  count: number;          // antal fuldførte prints
  totalGrams?: number;    // samlet filamentforbrug
  totalCost?: number;     // samlet pris (øre)
  lastPrintedAt?: string; // ISO-tid for seneste print
};

// En printer synkroniseret fra Bambuddy (til admin's "send til printer"-valg).
export type Printer = {
  id: string;
  name: string;
  model?: string;
  isActive?: boolean;
};

// En anmodning fra admin om at printe et produkts slicede fil på en printer.
// Shoppen kan ikke nå Bambuddy direkte → sidecaren henter åbne requests og
// kalder Bambuddys print-endpoint.
export type PrintRequest = {
  id: string;
  productId: string;
  productName?: string;
  printerId?: string;     // valgt printer; ellers sidecarens standard
  quantity: number;
  status: "open" | "done" | "failed";
  error?: string;
  createdAt: string;
  handledAt?: string;
};

export const MATERIALS = ["PLA", "PETG", "TPU", "ABS", "ASA", "Resin"];

export function formatPrintTime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}t` : `${h}t ${m}min`;
}

export function formatPrice(priceInOere: number): string {
  return `${(priceInOere / 100).toFixed(0)} kr`;
}
