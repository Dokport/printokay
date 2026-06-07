import { Product } from "@/lib/products";
import { SiteSettings, DEFAULT_SETTINGS } from "@/lib/settings";
import ShopClient from "@/components/ShopClient";
import { readJsonFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [products, storedSettings] = await Promise.all([
    readJsonFile<Product[]>("products.json", []),
    readJsonFile<Partial<SiteSettings>>("settings.json", {}),
  ]);

  const settings: SiteSettings = { ...DEFAULT_SETTINGS, ...storedSettings };

  return <ShopClient products={products} settings={settings} />;
}
