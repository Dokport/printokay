import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Script from "next/script";
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
        {/*
          Crypto-wallet browser extensions (MetaMask, Phantom, …) inject a
          `window.ethereum` object and sometimes throw while doing so. That noise
          has nothing to do with this shop, but Next's dev error overlay catches
          every window error and shows a red badge. Register a capture-phase
          handler BEFORE Next's runtime that swallows ONLY these injection errors,
          so real app errors still surface normally.
        */}
        <Script id="suppress-wallet-extension-noise" strategy="beforeInteractive">
          {`(function(){var W=['ethereum','selectedAddress','web3','evmAsk','MetaMask'];function hit(m){m=String(m||'');for(var i=0;i<W.length;i++){if(m.indexOf(W[i])!==-1)return true;}return false;}window.addEventListener('error',function(e){if(hit(e&&e.message)){e.stopImmediatePropagation();e.preventDefault();}},true);window.addEventListener('unhandledrejection',function(e){var r=e&&e.reason;if(hit(r&&r.message?r.message:r)){e.stopImmediatePropagation();e.preventDefault();}},true);})();`}
        </Script>
      </head>
      <body className={`${geist.className} min-h-screen`} style={{ backgroundColor: s.bgColor }}>
        <CartProvider>
          <Header siteName={s.siteName} logoEmoji={s.logoEmoji} logoImage={s.logoImage} primaryColor={s.primaryColor} accentColor={s.accentColor} />
          <main className="max-w-6xl mx-auto px-4 py-8">{children}</main>
          <footer className="text-center py-8 text-sm" style={{ color: s.primaryColor, opacity: 0.6 }}>
            © {new Date().getFullYear()} {s.siteName} · {s.footerText}
          </footer>
        </CartProvider>
      </body>
    </html>
  );
}
