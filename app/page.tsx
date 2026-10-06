import { Product } from "@/lib/products";
import { SiteSettings } from "@/lib/settings";
import ShopClient from "@/components/ShopClient";
import { readJsonFile } from "@/lib/storage";
import { mergeSettings } from "@/lib/settingsMerge";
import { publicProduct, publicSettings } from "@/lib/publicData";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [products, storedSettings] = await Promise.all([
    readJsonFile<Product[]>("products.json", []),
    readJsonFile<Partial<SiteSettings>>("settings.json", {}),
  ]);

  const settings: SiteSettings = mergeSettings(storedSettings);

  // Whatever goes to a client component is written into the page's HTML — so only
  // the public view of each record, never the admin's working data.
  return <ShopClient products={products.map(publicProduct)} settings={publicSettings(settings)} />;
}
