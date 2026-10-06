import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tillad adgang til dev-serveren fra det lokale netværk (fx datterens tablet/telefon).
  // Uden dette blokerer Next.js 16 cross-origin dev-ressourcer, så siden aldrig hydrerer
  // og knapper/login ikke virker når man tilgår via IP i stedet for localhost.
  allowedDevOrigins: ["192.168.8.21", "192.168.8.*", "192.168.*", "*.local"],
  images: {
    unoptimized: true,
  },
  // Headers for every response, API included. The Content-Security-Policy lives in
  // proxy.ts because it needs a fresh nonce per request; HSTS is already sent by
  // Vercel.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          // Don't let a browser second-guess a declared content type.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // No other site may frame the shop or the admin (clickjacking); the CSP's
          // frame-ancestors says the same to newer browsers.
          { key: "X-Frame-Options", value: "DENY" },
          // Other sites learn which site a visitor came from, not which page.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Nothing here uses these; refuse them so injected code can't either.
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
