/**
 * Server-side model analysis: parse a product's .3mf once and produce both the
 * colour setup (slots + zone mapping) and the display mesh — so the route can
 * pre-warm the mesh cache (light "Show plate" geometry) at save time, instead of
 * letting the first customer view pay the multi-MB parse.
 */
import { readBinaryFile } from "@/lib/storage";
import { parseThreeMf, type ParsedMesh } from "@/lib/threemf";
import type { ColorSlot, ColorZone } from "@/lib/products";

export type ModelAnalysis = {
  mesh: ParsedMesh;
  colorSlots: ColorSlot[];
  colorZones: ColorZone[];
};

export async function analyzeModel(file: string): Promise<ModelAnalysis | null> {
  const raw = await readBinaryFile(file);
  if (!raw) return null;

  let mesh: ParsedMesh;
  try {
    mesh = parseThreeMf(new Uint8Array(raw));
  } catch {
    return null;
  }
  if (!mesh.zones.length) return null;

  const colorSlots: ColorSlot[] = mesh.zones.map((_, i) => ({ id: `slot-${i + 1}`, label: `Farve ${i + 1}` }));
  const colorZones: ColorZone[] = mesh.zones.map((z, i) => ({ key: z.key, slotId: `slot-${i + 1}`, color: z.color }));

  return { mesh, colorSlots, colorZones };
}

export function meshCacheKey(file: string): string {
  return file.replace(/\.[^.]+$/, "") + ".mesh.json";
}

/** Back-compat: colour setup only. */
export async function deriveColorSetup(file: string) {
  const a = await analyzeModel(file);
  return a ? { colorSlots: a.colorSlots, colorZones: a.colorZones } : null;
}
