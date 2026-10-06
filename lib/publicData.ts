/**
 * What the public may see of the shop's own records. Server-only.
 *
 * Products and settings are stored with the admin's working data in them — material
 * cost, print time, grams, stock left on each spool, what a kilo cost, links to the
 * source model, Bambuddy ids — and both the API and the shop page used to hand all of
 * it to every visitor (the page inside its own HTML). Admin still gets everything;
 * everyone else gets this.
 */
import { createHash } from "crypto";
import type { Product } from "./products";
import type { SiteSettings, FilamentSpool } from "./settings";

/**
 * The shop needs two things from the model fields: whether there is a 3D model, and
 * a value that changes when it does (it keys the mesh cache). A hash gives both
 * without publishing where the project files are stored.
 */
function modelVersion(p: Product): string | undefined {
  const path = p.previewModel || p.modelFile;
  return path ? `mv-${createHash("sha256").update(path).digest("hex").slice(0, 16)}` : undefined;
}

export function publicProduct(p: Product): Product {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    price: p.price,
    image: p.image,
    ...(p.images ? { images: p.images } : {}),
    emoji: p.emoji,
    category: p.category,
    material: p.material,
    colorSlots: p.colorSlots,
    ...(p.colorZones ? { colorZones: p.colorZones } : {}),
    modelUrl: "",
    ...(modelVersion(p) ? { modelFile: modelVersion(p) } : {}),
  };
}

function publicFilament(f: FilamentSpool): FilamentSpool {
  return { id: f.id, name: f.name, material: f.material, colorHex: f.colorHex, inStock: f.inStock };
}

export function publicSettings(s: SiteSettings): SiteSettings {
  return { ...s, filaments: (s.filaments ?? []).map(publicFilament) };
}
