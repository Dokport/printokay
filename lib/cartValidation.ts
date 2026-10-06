/**
 * What a cart is allowed to contain — checked on the server, against the same rules
 * the configurators enforce in the browser. Server-only.
 *
 * Prices were already the server's. What was not: everything that decides what gets
 * PRINTED. A hand-built request could order the heart shape the shop withdrew, a side
 * eye on a round tag, a filament that isn't on the shelf, a 50,000-character name, or
 * a thousand lines that each made the server build a full mesh before saying no.
 *
 * Two things happen here, in this order:
 *   1. Cheap checks first — counts, lengths, types — before anything expensive runs.
 *   2. Each item is REBUILT from the shop's own data. Names, colour codes, labels and
 *      the font size come from settings and the product list, never from the cart;
 *      what the customer chose is reduced to ids and text.
 */
import type { CartItem, ColorChoice, KeyringCartData, FidgetCartData } from "./cart";
import type { FilamentSpool } from "./settings";
import type { Product } from "./products";
import {
  KEYRING_FONTS, KEYRING_SHAPES, holePositionsFor, MAX_TEXT_LENGTH, calcFontSize, calcPrice,
  DEFAULT_KEYRING_SETTINGS,
} from "./keyring";
import { MAX_LINES, splitTextLines } from "./textpaths";
import {
  DEFAULT_FIDGET_SETTINGS, calcFidgetPrice, normalizeLabels, validateFidget, fidgetFilaments,
} from "./fidget";
import type { SiteSettings } from "./settings";

/** More lines than any real order; each keyring line costs a mesh build to check. */
export const MAX_CART_LINES = 25;
export const MAX_LINE_QUANTITY = 50;
const MAX_NOTE_LENGTH = 300;
const MAX_CART_KEY_LENGTH = 300;

export type CartCheck = { ok: true; items: CartItem[] } | { ok: false; error: string };

const isStr = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;

export function validateCart(
  raw: unknown,
  settings: SiteSettings,
  productById: (id: string) => Product | undefined
): CartCheck {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "Kurven er tom." };
  if (raw.length > MAX_CART_LINES) {
    return { ok: false, error: `Højst ${MAX_CART_LINES} forskellige varer pr. bestilling.` };
  }

  // The filaments the configurators offer: in stock and PLA.
  const shelf = new Map(
    (settings.filaments ?? []).filter((f) => f.inStock && f.material === "PLA").map((f) => [f.id, f])
  );

  const items: CartItem[] = [];
  for (const item of raw as Record<string, unknown>[]) {
    if (!item || typeof item !== "object") return { ok: false, error: "Ugyldig vare i kurven." };
    const quantity = item.quantity;
    if (!Number.isInteger(quantity) || (quantity as number) < 1 || (quantity as number) > MAX_LINE_QUANTITY) {
      return { ok: false, error: `Antal skal være mellem 1 og ${MAX_LINE_QUANTITY}.` };
    }
    if (!isStr(item.cartKey, MAX_CART_KEY_LENGTH)) return { ok: false, error: "Ugyldig vare i kurven." };

    const checked = item.keyringData
      ? keyring(item.keyringData as Record<string, unknown>, settings, shelf)
      : item.fidgetData
        ? fidget(item.fidgetData as Record<string, unknown>, settings)
        : product(item, productById, shelf);
    if (!checked.ok) return checked;

    items.push({ ...checked.item, cartKey: item.cartKey as string, quantity: quantity as number });
  }
  return { ok: true, items };
}

type Partial = { ok: true; item: Omit<CartItem, "cartKey" | "quantity"> } | { ok: false; error: string };

function filamentError(what: string): { ok: false; error: string } {
  return { ok: false, error: `Farven til ${what} findes ikke på lager længere — vælg en anden.` };
}

function keyring(kd: Record<string, unknown>, settings: SiteSettings, shelf: Map<string, FilamentSpool>): Partial {
  if (typeof kd.text !== "string") return { ok: false, error: "Ugyldig tekst på nøglering." };
  // Counted here, not with splitTextLines: that one quietly keeps the first two lines
  // and drops the rest, so a third line would vanish instead of being refused.
  const given = kd.text.split("\n").map((l) => l.trim()).filter(Boolean);
  const lines = splitTextLines(kd.text);
  if (given.length === 0 || given.length > MAX_LINES || given.some((l) => l.length > MAX_TEXT_LENGTH)) {
    return { ok: false, error: `Højst ${MAX_LINES} linjer med ${MAX_TEXT_LENGTH} tegn på en nøglering.` };
  }
  if (!KEYRING_FONTS.some((f) => f.id === kd.font)) return { ok: false, error: "Skrifttypen kan ikke vælges." };
  if (!KEYRING_SHAPES.some((s) => s.id === kd.shapeType)) return { ok: false, error: "Formen kan ikke vælges." };
  const hole = kd.holePosition ?? "top";
  if (!holePositionsFor(kd.shapeType as string).some((h) => h.id === hole)) {
    return { ok: false, error: "Hullets placering passer ikke til formen." };
  }
  const sizes = settings.keyring?.sizes?.length ? settings.keyring.sizes : DEFAULT_KEYRING_SETTINGS.sizes;
  const size = sizes.find((s) => s.id === kd.sizeId);
  if (!size) return { ok: false, error: "Størrelsen sælges ikke længere — vælg en anden." };

  const base = shelf.get(kd.baseFilamentId as string);
  const text = shelf.get(kd.textFilamentId as string);
  if (!base) return filamentError("nøgleringen");
  if (!text) return filamentError("teksten");
  if (base.id === text.id) return { ok: false, error: "Tekst og nøglering skal have hver sin farve." };

  const joined = lines.join("\n");
  const keyringData: KeyringCartData = {
    text: joined,
    font: kd.font as string,
    shapeType: kd.shapeType as string,
    holePosition: hole as KeyringCartData["holePosition"],
    sizeId: size.id,
    sizeLabel: size.label,
    baseFilamentId: base.id,
    baseFilamentName: base.name,
    baseColorHex: base.colorHex,
    textFilamentId: text.id,
    textFilamentName: text.name,
    textColorHex: text.colorHex,
    // The configurator derives this from text, font and size; so do we — it's a
    // print parameter and no business of the request.
    fontSize: calcFontSize(joined, kd.font as string, size) ?? 0,
    price: calcPrice(size),
  };
  return { ok: true, item: { product: { id: "keyring" } as Product, colorChoices: [], keyringData } };
}

function fidget(fd: Record<string, unknown>, settings: SiteSettings): Partial {
  const fs = { ...DEFAULT_FIDGET_SETTINGS, ...(settings.fidget ?? {}) };
  if (!fs.enabled) return { ok: false, error: "Fidget clickeren sælges ikke lige nu." };
  if (!Array.isArray(fd.labels) || !fd.labels.every((l) => typeof l === "string" && l.length <= 20)) {
    return { ok: false, error: "Ugyldig tekst på knapperne." };
  }
  const cfg = {
    cols: fd.cols as number,
    rows: fd.rows as number,
    labels: fd.labels as string[],
    keyring: !!fd.keyring,
    boxFilamentId: String(fd.boxFilamentId ?? ""),
    capFilamentId: String(fd.capFilamentId ?? ""),
    textFilamentId: String(fd.textFilamentId ?? ""),
  };
  // The configurator's own rule set: grid, label length, offered colours, cap ≠ text.
  const v = validateFidget(cfg, settings.filaments ?? [], fs);
  if (!v.ok) return { ok: false, error: v.error ?? "Fidget clickeren kan ikke bestilles sådan." };

  const offered = new Map(fidgetFilaments(fs, settings.filaments ?? []).map((f) => [f.id, f]));
  const box = offered.get(cfg.boxFilamentId)!, cap = offered.get(cfg.capFilamentId)!, txt = offered.get(cfg.textFilamentId)!;
  const fidgetData: FidgetCartData = {
    cols: cfg.cols,
    rows: cfg.rows,
    labels: normalizeLabels(cfg),
    keyring: cfg.keyring,
    boxFilamentId: box.id, boxFilamentName: box.name, boxColorHex: box.colorHex,
    capFilamentId: cap.id, capFilamentName: cap.name, capColorHex: cap.colorHex,
    textFilamentId: txt.id, textFilamentName: txt.name, textColorHex: txt.colorHex,
    switchLabel: fs.switchLabel,
    price: calcFidgetPrice(cfg, fs),
  };
  return { ok: true, item: { product: { id: "fidget" } as Product, colorChoices: [], fidgetData } };
}

function product(
  item: Record<string, unknown>,
  productById: (id: string) => Product | undefined,
  shelf: Map<string, FilamentSpool>
): Partial {
  const id = (item.product as Record<string, unknown> | undefined)?.id;
  const p = typeof id === "string" ? productById(id) : undefined;
  if (!p) return { ok: false, error: "En vare i kurven sælges ikke længere — fjern den." };

  const slots = p.colorSlots ?? [];
  const given = Array.isArray(item.colorChoices) ? (item.colorChoices as Record<string, unknown>[]) : [];
  if (given.length !== slots.length) return { ok: false, error: `Vælg en farve til hvert felt på ${p.name}.` };

  const colorChoices: ColorChoice[] = [];
  for (const slot of slots) {
    const pick = given.find((c) => c && c.slotId === slot.id);
    const fil = pick ? shelf.get(pick.filamentId as string) : undefined;
    if (!pick) return { ok: false, error: `Vælg en farve til ${slot.label} på ${p.name}.` };
    if (!fil) return filamentError(`${slot.label} på ${p.name}`);
    colorChoices.push({
      slotId: slot.id, slotLabel: slot.label,
      filamentId: fil.id, filamentName: fil.name, filamentColor: fil.colorHex,
    });
  }

  const note = item.note;
  if (note !== undefined && note !== null && !isStr(note, MAX_NOTE_LENGTH)) {
    return { ok: false, error: `Noten må højst være ${MAX_NOTE_LENGTH} tegn.` };
  }
  return {
    ok: true,
    item: { product: p, colorChoices, ...(typeof note === "string" && note.trim() ? { note: note.trim() } : {}) },
  };
}
