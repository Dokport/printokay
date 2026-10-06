/**
 * Content-Security-Policy for every page, with a fresh nonce per request.
 *
 * The policy is what turns an injected <script> into a dead one: only scripts
 * carrying this request's nonce run, and 'strict-dynamic' lets those load the rest
 * of the app's chunks. Next reads the nonce from the request's CSP header and puts
 * it on its own scripts, which is why it is set on the request as well as the
 * response. All pages here are already dynamically rendered, so per-request nonces
 * cost nothing extra.
 *
 * What it allows, and why:
 *   style-src 'unsafe-inline'  React renders style="" attributes, which nonces
 *                              can't cover; injected CSS can't run code.
 *   connect-src vercel.com     admin uploads model files straight from the browser
 *                              to Vercel Blob (https://vercel.com/api/blob).
 *   img-src blob: data:        3D canvases and in-page previews.
 */
import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const dev = process.env.NODE_ENV === "development";

  const csp = [
    "default-src 'self'",
    // React needs eval in development only, for its error overlays.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self' data:",
    // ws: in development is the hot-reload socket.
    `connect-src 'self' https://vercel.com https://*.blob.vercel-storage.com${dev ? " ws: wss:" : ""}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Only over https — on plain-http localhost it would push every request to an
    // https:// address nothing answers.
    ...(request.nextUrl.protocol === "https:" ? ["upgrade-insecure-requests"] : []),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      // Pages only. API responses are JSON (and /api/img sets its own sandbox),
      // static files don't run, and prefetches don't need a policy of their own.
      source: "/((?!api|_next/static|_next/image|favicon.ico|fonts/|products/|.*\\.(?:png|jpe?g|webp|gif|svg|ico|ttf|woff2?)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
