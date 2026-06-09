/**
 * Minimal 3MF mesh extractor (server-side).
 *
 * A .3mf is a ZIP. Bambu/MakerWorld project files keep the mesh in one or more
 * `3D/Objects/*.model` (or inline in `3D/3dmodel.model`) as plain XML:
 *
 *   <vertices><vertex x="" y="" z="" /> …</vertices>
 *   <triangles><triangle v1="" v2="" v3="" paint_color="" /> …</triangles>
 *
 * `paint_color` is Bambu's per-triangle MMU segmentation — each distinct value
 * is a colour zone (triangles without it use the object's default extruder, which
 * we key as "default"). We don't decode the exact extruder; we just group
 * triangles by zone so each zone can be coloured with a customer-chosen filament.
 *
 * v1 assumption: one logical object (multiple object files are concatenated with
 * vertex-index offsets; per-object build transforms are ignored — the viewer
 * just centres + fits the mesh).
 */
import { unzipSync, strFromU8 } from "fflate";

export type MeshZone = { key: string; indices: number[]; color?: string };
export type ParsedMesh = { positions: number[]; zones: MeshZone[] };

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : null;
}

function normHex(c: string): string {
  let h = c.trim().replace(/^#/, "");
  if (h.length >= 6) return "#" + h.slice(0, 6).toUpperCase();
  return "#888888";
}

/**
 * The model's intended filament colours, in slot order. Bambu stores them in
 * `project_settings.config` (`filament_colour`), or older sliced exports list
 * them in `slice_info.config` (`<filament … color="…">`).
 */
function extractModelColors(files: Record<string, Uint8Array>): string[] {
  // project_settings.config (JSON)
  const ps = Object.keys(files).find((n) => /project_settings\.config$/i.test(n));
  if (ps) {
    try {
      const cfg = JSON.parse(strFromU8(files[ps]));
      const arr = cfg.filament_colour ?? cfg.filament_multi_colour;
      if (Array.isArray(arr) && arr.length) return arr.map((c: string) => normHex(c));
    } catch { /* fall through */ }
  }
  // slice_info.config (XML)
  const si = Object.keys(files).find((n) => /slice_info\.config$/i.test(n));
  if (si) {
    const xml = strFromU8(files[si]);
    const fils = xml.match(/<filament\b[^>]*\/?>/g) ?? [];
    const colors = fils
      .sort((a, b) => Number(attr(a, "id") ?? 0) - Number(attr(b, "id") ?? 0))
      .map((f) => attr(f, "color"))
      .filter(Boolean) as string[];
    if (colors.length) return colors.map(normHex);
  }
  return [];
}

export function parseThreeMf(buffer: Uint8Array): ParsedMesh {
  const files = unzipSync(buffer);

  // Model XML lives under 3D/…/*.model. Parse every one that carries geometry.
  const modelNames = Object.keys(files)
    .filter((n) => /3D\/.*\.model$/i.test(n))
    .sort(); // 3dmodel.model before Objects/*, deterministic order

  const positions: number[] = [];
  const zoneMap = new Map<string, number[]>();

  for (const name of modelNames) {
    const xml = strFromU8(files[name]);
    if (!xml.includes("<vertex")) continue;

    // Vertices for THIS file start at this offset in the combined buffer.
    const baseIndex = positions.length / 3;

    const vtx = xml.match(/<vertex\b[^>]*\/?>/g) ?? [];
    for (const v of vtx) {
      positions.push(
        parseFloat(attr(v, "x") ?? "0"),
        parseFloat(attr(v, "y") ?? "0"),
        parseFloat(attr(v, "z") ?? "0")
      );
    }

    const tris = xml.match(/<triangle\b[^>]*\/?>/g) ?? [];
    for (const t of tris) {
      const v1 = parseInt(attr(t, "v1") ?? "", 10);
      const v2 = parseInt(attr(t, "v2") ?? "", 10);
      const v3 = parseInt(attr(t, "v3") ?? "", 10);
      if (Number.isNaN(v1) || Number.isNaN(v2) || Number.isNaN(v3)) continue;
      const key = attr(t, "paint_color") ?? "default";
      let arr = zoneMap.get(key);
      if (!arr) zoneMap.set(key, (arr = []));
      arr.push(baseIndex + v1, baseIndex + v2, baseIndex + v3);
    }
  }

  // Stable zone order: "default" first (base extruder), then by numeric value.
  const ordered = [...zoneMap.entries()].sort((a, b) => {
    if (a[0] === "default") return -1;
    if (b[0] === "default") return 1;
    const na = parseInt(a[0], 16), nb = parseInt(b[0], 16);
    if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
    return a[0].localeCompare(b[0]);
  });

  // Pair each zone with the model's filament colour by order.
  const modelColors = extractModelColors(files);
  const zones: MeshZone[] = ordered.map(([key, indices], i) => ({
    key,
    indices,
    color: modelColors[i],
  }));

  return { positions, zones };
}
