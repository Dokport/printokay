import { Product } from "@/lib/products";
import { SiteSettings } from "@/lib/settings";
import ShopClient from "@/components/ShopClient";
import { readJsonFile } from "@/lib/storage";
import { mergeSettings } from "@/lib/settingsMerge";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [products, storedSettings] = await Promise.all([
    readJsonFile<Product[]>("products.json", []),
    readJsonFile<Partial<SiteSettings>>("settings.json", {}),
  ]);

  const settings: SiteSettings = mergeSettings(storedSettings);

  return <ShopClient products={products} settings={settings} />;
}
