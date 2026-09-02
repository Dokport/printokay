/**
 * One place that turns what's stored into a complete SiteSettings.
 *
 * The stored file is whatever admin last saved, so it lags the code: every new
 * field is missing from it. A plain `{ ...DEFAULT_SETTINGS, ...stored }` replaces
 * whole objects, so a saved `keyring` wipes out every default inside it — which is
 * how a new setting can be live in the code, pass its tests, and still do nothing
 * on the real shop.
 */
import { DEFAULT_SETTINGS, type SiteSettings } from "./settings";
import { DEFAULT_KEYRING_SETTINGS, type KeyringSizeOption } from "./keyring";

/** Fill in whatever a saved size predates, matching on id. */
function completeSize(size: Partial<KeyringSizeOption> & { id: string }): KeyringSizeOption {
  const fallback = DEFAULT_KEYRING_SETTINGS.sizes.find((d) => d.id === size.id);
  const widthMm = size.widthMm ?? fallback?.widthMm ?? 60;
  const heightMm = size.heightMm ?? fallback?.heightMm ?? 28;
  return {
    id: size.id,
    label: size.label ?? fallback?.label ?? size.id,
    textHeightMm: size.textHeightMm ?? fallback?.textHeightMm ?? Math.round(heightMm * 0.5),
    widthMm,
    heightMm,
    // A size sold before areas existed keeps the footprint its dimensions implied,
    // so nothing on the shop silently changes shape the day this ships.
    areaCm2: size.areaCm2 || fallback?.areaCm2 || (widthMm * heightMm * 0.75) / 100,
    basePrice: size.basePrice ?? fallback?.basePrice ?? 0,
  };
}

export function mergeSettings(stored: Partial<SiteSettings> | null | undefined): SiteSettings {
  const merged = { ...DEFAULT_SETTINGS, ...(stored ?? {}) } as SiteSettings;
  const keyring = stored?.keyring;
  const sizes = keyring?.sizes?.length ? keyring.sizes : DEFAULT_KEYRING_SETTINGS.sizes;
  merged.keyring = {
    ...DEFAULT_KEYRING_SETTINGS,
    ...(keyring ?? {}),
    sizes: sizes.map(completeSize),
  };
  return merged;
}
