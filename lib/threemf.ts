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

export type MeshZone = { key: string; indices: number[] };
export type ParsedMesh = { positions: number[]; zones: MeshZone[] };

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : null;
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

  // Stable zone order: "default" first (base extruder), then by key.
  const zones: MeshZone[] = [...zoneMap.entries()]
    .sort((a, b) => (a[0] === "default" ? -1 : b[0] === "default" ? 1 : a[0].localeCompare(b[0])))
    .map(([key, indices]) => ({ key, indices }));

  return { positions, zones };
}
