export type ColorSlot = {
  id: string;
  label: string; // e.g. "Krop", "Øjne", "Base"
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
