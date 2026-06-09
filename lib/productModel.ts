/**
 * Derive a product's colour setup (slots + zone mapping) automatically from its
 * uploaded .3mf: one colorSlot per paint_color zone, each zone keeping the
 * model's intended colour for default-filament matching in the shop.
 *
 * Server-side only (reads the model from storage + unzips it).
 */
import { readBinaryFile } from "@/lib/storage";
import { parseThreeMf } from "@/lib/threemf";
import type { ColorSlot, ColorZone } from "@/lib/products";

export async function deriveColorSetup(
  modelFile: string
): Promise<{ colorSlots: ColorSlot[]; colorZones: ColorZone[] } | null> {
  const raw = await readBinaryFile(modelFile);
  if (!raw) return null;

  let zones;
  try {
    ({ zones } = parseThreeMf(new Uint8Array(raw)));
  } catch {
    return null;
  }
  if (!zones.length) return null;

  const colorSlots: ColorSlot[] = zones.map((_, i) => ({
    id: `slot-${i + 1}`,
    label: `Farve ${i + 1}`,
  }));
  const colorZones: ColorZone[] = zones.map((z, i) => ({
    key: z.key,
    slotId: `slot-${i + 1}`,
    color: z.color,
  }));

  return { colorSlots, colorZones };
}
