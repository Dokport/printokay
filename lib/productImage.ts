/**
 * The one shape of blob path that may be served publicly: a product image.
 *
 * The blob store also holds orders, promo codes and settings, all under fixed,
 * guessable names — so the image proxy must refuse anything that is not exactly
 * this. Raster formats only: an SVG can carry script, and served from our own
 * origin it would run as us.
 */
export const PRODUCT_IMAGE_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

const PRODUCT_IMAGE_PATH = /^products\/[A-Za-z0-9_-]+\.([A-Za-z0-9]+)$/;

/** The content type to serve `pathname` as, or null if it must not be served. */
export function productImageType(pathname: string): string | null {
  const m = PRODUCT_IMAGE_PATH.exec(pathname);
  return m ? PRODUCT_IMAGE_TYPES[m[1].toLowerCase()] ?? null : null;
}
