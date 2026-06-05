import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Tillad adgang til dev-serveren fra det lokale netværk (fx datterens tablet/telefon).
  // Uden dette blokerer Next.js 16 cross-origin dev-ressourcer, så siden aldrig hydrerer
  // og knapper/login ikke virker når man tilgår via IP i stedet for localhost.
  allowedDevOrigins: ["192.168.8.21", "192.168.8.*", "192.168.*", "*.local"],
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
