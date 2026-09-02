/**
 * Server-side prices.
 *
 * The cart travels through the browser, so every price in it is a claim, not a
 * fact — a hand-edited request can offer to pay 1 kr for anything. Nothing that
 * decides an amount may read a price out of the request body; it has to come back
 * from the shop's own settings and product list.
 *
 * Keyring prices in particular are looked up live by size id, so changing a price
 * in admin takes effect immediately — including for a cart that was filled before
 * the change, and for what a promo code is worth.
 */
import type { CartItem } from "./cart";
import type { Product } from "./products";
import { calcPrice, DEFAULT_KEYRING_SETTINGS } from "./keyring";
import { DEFAULT_SETTINGS, type SiteSettings } from "./settings";
import { readJsonFile } from "./storage";

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
  const settings = { ...DEFAULT_SETTINGS, ...stored } as SiteSettings;
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
export function priceCart(
  items: CartItem[],
  pricing: Pricing
): { ok: true; prices: number[] } | { ok: false; error: string } {
  const prices: number[] = [];
  for (const item of items) {
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
