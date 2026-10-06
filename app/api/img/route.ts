/**
 * Proxy route for private Vercel Blob images.
 *
 * Blob images are stored with access:"private", so their blob URLs can't be
 * loaded directly by browsers. This route fetches them server-side (using the
 * BLOB_READ_WRITE_TOKEN) and streams the bytes back to the browser.
 *
 * Usage: /api/img?p=products%2F1234567890.jpg
 *
 * Only product images. The same private store holds orders.json, promos.json and
 * settings.json, and this route reads with the server's own token — without the
 * check below it handed any of them to anyone who asked.
 */

import { NextRequest, NextResponse } from "next/server";
import { get } from "@vercel/blob";
import { productImageType } from "@/lib/productImage";

export async function GET(req: NextRequest) {
  const pathname = req.nextUrl.searchParams.get("p");
  // Same answer for "not allowed" and "not there": the route should not confirm
  // which other files exist.
  const contentType = pathname ? productImageType(pathname) : null;
  if (!pathname || !contentType) {
    return new NextResponse("Not found", { status: 404 });
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    // Local dev: not used (upload route returns /products/... paths from public/)
    return new NextResponse("Not available in local dev", { status: 404 });
  }

  try {
    const result = await get(pathname, { access: "private", useCache: false });
    if (!result || !result.stream) {
      return new NextResponse("Not found", { status: 404 });
    }

    // Typed from the extension we allowed, not from whatever the blob claims.
    return new NextResponse(result.stream, {
      headers: {
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        // Cache for 1 day in the browser; Vercel Edge caches 1 hour.
        "Cache-Control": "public, max-age=86400, s-maxage=3600",
      },
    });
  } catch {
    return new NextResponse("Error fetching image", { status: 500 });
  }
}
