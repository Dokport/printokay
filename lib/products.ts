export type Product = {
  id: string;
  name: string;
  description: string;
  price: number; // in DKK øre (e.g. 4900 = 49 kr)
  image: string;
  emoji: string;
  category: string; // dynamic — defined in settings.json
};

export function formatPrice(priceInOere: number): string {
  return `${(priceInOere / 100).toFixed(0)} kr`;
}
