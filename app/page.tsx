import fs from "fs";
import path from "path";
import { Product } from "@/lib/products";
import { SiteSettings, DEFAULT_SETTINGS } from "@/lib/settings";
import ShopClient from "@/components/ShopClient";

export const dynamic = "force-dynamic";

export default function Home() {
  const products: Product[] = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "data", "products.json"), "utf-8")
  );
  let settings: SiteSettings = DEFAULT_SETTINGS;
  try {
    settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "settings.json"), "utf-8")) };
  } catch {}

  return <ShopClient products={products} settings={settings} />;
}
