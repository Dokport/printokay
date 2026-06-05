import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { CartProvider } from "@/lib/cartContext";
import Header from "@/components/Header";
import fs from "fs";
import path from "path";
import { SiteSettings, DEFAULT_SETTINGS } from "@/lib/settings";

export const dynamic = "force-dynamic";

const geist = Geist({ subsets: ["latin"] });

function loadSettings(): SiteSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "settings.json"), "utf-8")) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const s = loadSettings();
  return {
    title: `${s.siteName} — 3D printede figurer & gadgets`,
    description: s.tagline,
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const s = loadSettings();

  const cssVars = `
    :root {
      --color-primary: ${s.primaryColor};
      --color-accent: ${s.accentColor};
      --color-bg: ${s.bgColor};
    }
  `;

  return (
    <html lang="da">
      <head>
        <style dangerouslySetInnerHTML={{ __html: cssVars }} />
      </head>
      <body className={`${geist.className} min-h-screen`} style={{ backgroundColor: s.bgColor }}>
        <CartProvider>
          <Header siteName={s.siteName} logoEmoji={s.logoEmoji} primaryColor={s.primaryColor} accentColor={s.accentColor} />
          <main className="max-w-6xl mx-auto px-4 py-8">{children}</main>
          <footer className="text-center py-8 text-sm" style={{ color: s.primaryColor, opacity: 0.6 }}>
            © {new Date().getFullYear()} {s.siteName} · {s.footerText}
          </footer>
        </CartProvider>
      </body>
    </html>
  );
}
