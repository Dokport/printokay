/**
 * Server-side prices.
 *
 * The cart travels through the browser, so every price in it is a claim, not a
 * fact — a hand-edited request can offer to pay 1 kr for anything. Nothing that
 * decides an amount may read a price out of the request body; it has to come back
 * from the shop's own settings and product list.
 *
 * Keyring prices are looked up live by size id, so changing a price in admin takes
 * effect immediately — including for a cart that was filled before the change, and
 * for what a promo code is worth. Every size is built to the same plate area, so the
 * one price per size is the same value for money whatever the text and shape.
 */
import type { CartItem } from "./cart";
import type { Product } from "./products";
import {
  calcPrice, calcFontSize, lineCapHeight, MIN_CAP_HEIGHT_MM, DEFAULT_KEYRING_SETTINGS,
} from "./keyring";
import type { KeyringConfig } from "./keyring";
import { buildKeyringMesh } from "./keyringMesh";
import { extractTextContours } from "./textpaths.server";
import { type SiteSettings } from "./settings";
import { readJsonFile } from "./storage";
import { mergeSettings } from "./settingsMerge";

export type Pricing = {
  settings: SiteSettings;
  /** The shop's own price for this item, or null if it no longer sells it. */
  priceOf(item: CartItem): number | null;
};

export async function loadPricing(): Promise<Pricing> {
  const [stored, products] = await Promise.all([
    readJsonFile<Partial<SiteSettings>>("settings.json", {}),
    readJsonFile<Product[]>("products.json", []),
  ]);
  const settings = mergeSettings(stored);
  const sizes = settings.keyring?.sizes?.length
    ? settings.keyring.sizes
    : DEFAULT_KEYRING_SETTINGS.sizes;
  const byId = new Map(products.map((p) => [p.id, p]));

  return {
    settings,
    priceOf(item: CartItem): number | null {
      if (item.keyringData) {
        const size = sizes.find((s) => s.id === item.keyringData!.sizeId);
        return size ? calcPrice(size) : null;
      }
      const product = byId.get(item.product?.id);
      return product ? product.price : null;
    },
  };
}

/**
 * Price every line, refusing the whole cart if any item can't be priced — a
 * discontinued product or a removed keyring size must stop the checkout rather
 * than fall back to whatever the browser suggested.
 */
/**
 * Would this keyring actually print? A size is a fixed plate area, so a long name is
 * written smaller rather than on a bigger tag, and past a point the lettering stops
 * being printable. The configurator refuses those keystrokes; this is the check that
 * a hand-built request can't skip.
 */
function keyringIsPrintable(item: CartItem, pricing: Pricing): boolean {
  const kd = item.keyringData;
  if (!kd) return true;
  const size = pricing.settings.keyring?.sizes?.find((s) => s.id === kd.sizeId);
  if (!size) return true; // the missing-size case is reported separately
  try {
    const fontSize = calcFontSize(kd.text, kd.font, size) ?? 0;
    const { textScale } = buildKeyringMesh(
      extractTextContours(kd.text, kd.font, fontSize),
      {
        text: kd.text, font: kd.font,
        shapeType: kd.shapeType as KeyringConfig["shapeType"],
        holePosition: kd.holePosition ?? "top",
        sizeId: kd.sizeId, baseFilamentId: kd.baseFilamentId,
        textFilamentId: kd.textFilamentId, fontSize,
      },
      size
    );
    return lineCapHeight(kd.text, size) * textScale >= MIN_CAP_HEIGHT_MM;
  } catch (err) {
    // Don't block a sale on a measurement we couldn't take.
    console.error(`Kunne ikke måle nøglering "${kd.text}":`, err);
    return true;
  }
}

export function priceCart(
  items: CartItem[],
  pricing: Pricing
): { ok: true; prices: number[] } | { ok: false; error: string } {
  const prices: number[] = [];
  for (const item of items) {
    if (item.keyringData && !keyringIsPrintable(item, pricing)) {
      return {
        ok: false,
        error: `Teksten "${item.keyringData.text.replace(/\n/g, " / ")}" er for lang til størrelsen ${item.keyringData.sizeLabel} — vælg en større.`,
      };
    }
    const price = pricing.priceOf(item);
    if (price === null) {
      const name = item.keyringData
        ? `nøglering (${item.keyringData.sizeLabel})`
        : item.product?.name || "en vare";
      return { ok: false, error: `${name} sælges ikke længere — fjern den fra kurven.` };
    }
    prices.push(price);
  }
  return { ok: true, prices };
}
