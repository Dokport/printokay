/**
 * Font loading in the browser: fetch + parse once per font id, cached.
 *
 * Deliberately its own module rather than living beside the 3D preview. The preview
 * is loaded lazily so three.js stays out of the initial bundle, and the configurator
 * needs fonts too — to measure the plate area every size would have, which is what
 * the price is worked out from. Importing it from the preview would drag three.js
 * back in for everyone.
 */
import { parse } from "opentype.js";
import type { OpenTypeFontLike } from "./textpaths";

const cache = new Map<string, Promise<OpenTypeFontLike>>();

export function loadFont(fontId: string): Promise<OpenTypeFontLike> {
  let pending = cache.get(fontId);
  if (!pending) {
    pending = fetch(`/fonts/${fontId}.ttf`)
      .then((res) => {
        if (!res.ok) throw new Error(`Kunne ikke hente font: ${fontId}`);
        return res.arrayBuffer();
      })
      .then((buf) => parse(buf) as unknown as OpenTypeFontLike);
    cache.set(fontId, pending);
  }
  return pending;
}
