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

export type ProjectMeta = {
  title?: string;
  description?: string;
  material?: string;
  thumbnail?: Uint8Array; // a render PNG, if present
};

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

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?34;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function cleanText(raw: string): string {
  // Bambu stores rich text double-encoded; decode twice, strip tags, collapse.
  let s = decodeEntities(decodeEntities(raw));
  s = s.replace(/<[^>]+>/g, " ");
  return s.replace(/\s+/g, " ").trim();
}

function modelMeta(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<metadata name="${name}">([^<]*)</metadata>`));
  return m ? cleanText(m[1]) : undefined;
}

/** Extract product metadata (name, description, material, thumbnail) from a .3mf. */
export function parseThreeMfMeta(buffer: Uint8Array): ProjectMeta {
  const files = unzipSync(buffer);
  const meta: ProjectMeta = {};

  const modelName = Object.keys(files).find((n) => /3D\/3dmodel\.model$/i.test(n));
  if (modelName) {
    const xml = strFromU8(files[modelName]);
    meta.title = modelMeta(xml, "Title");
    meta.description = modelMeta(xml, "Description");
  }

  const ps = Object.keys(files).find((n) => /project_settings\.config$/i.test(n));
  if (ps) {
    try {
      const cfg = JSON.parse(strFromU8(files[ps]));
      const t = cfg.filament_type;
      if (Array.isArray(t) && t.length) meta.material = String(t[0]);
    } catch { /* ignore */ }
  }

  // Prefer the nice rendered thumbnail; fall back to the plate image.
  const thumbName =
    Object.keys(files).find((n) => /thumbnail_middle\.png$/i.test(n)) ||
    Object.keys(files).find((n) => /Metadata\/plate_1\.png$/i.test(n));
  if (thumbName) meta.thumbnail = files[thumbName];

  return meta;
}

// ── 3MF transforms (row-vector convention; 12 values → 4×4 row-major) ─────────
type Mat = number[]; // length 16, row-major
const IDENTITY: Mat = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function parseTransform(s?: string | null): Mat {
  if (!s) return IDENTITY.slice();
  const v = s.trim().split(/\s+/).map(Number);
  if (v.length < 12 || v.some((n) => Number.isNaN(n))) return IDENTITY.slice();
  return [v[0], v[1], v[2], 0, v[3], v[4], v[5], 0, v[6], v[7], v[8], 0, v[9], v[10], v[11], 1];
}

function mat4Mul(a: Mat, b: Mat): Mat {
  const r = new Array(16).fill(0);
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[i * 4 + k] * b[k * 4 + j];
      r[i * 4 + j] = s;
    }
  return r;
}

// Row-vector transform: p' = [x y z 1] · M
function applyMat(m: Mat, x: number, y: number, z: number): [number, number, number] {
  return [
    x * m[0] + y * m[4] + z * m[8] + m[12],
    x * m[1] + y * m[5] + z * m[9] + m[13],
    x * m[2] + y * m[6] + z * m[10] + m[14],
  ];
}

/**
 * Resolve the build graph (3dmodel.model `<build><item>` → resource objects →
 * `<component>` paths to Objects/*.model) into a flat list of meshes, each with
 * its composed world transform. This places multi-object models correctly
 * (matching the build plate / posed layout) instead of stacking them at origin.
 */
function collectPlacements(files: Record<string, Uint8Array>): { meshXml: string; matrix: Mat }[] {
  const out: { meshXml: string; matrix: Mat }[] = [];
  const rootName = Object.keys(files).find((n) => /3D\/3dmodel\.model$/i.test(n));
  if (!rootName) return out;
  const rootXml = strFromU8(files[rootName]);

  // Resource objects: id → { components, innerXml }
  const resObjects = new Map<string, { components: { objectid: string; path: string; transform: string }[]; innerXml: string }>();
  const resBlock = rootXml.match(/<resources\b[^>]*>([\s\S]*?)<\/resources>/i)?.[1] ?? "";
  const objRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/gi;
  let om: RegExpExecArray | null;
  while ((om = objRe.exec(resBlock))) {
    const id = om[1].match(/\bid="([^"]+)"/)?.[1];
    if (!id) continue;
    const inner = om[2];
    const components: { objectid: string; path: string; transform: string }[] = [];
    const compRe = /<component\b[^>]*\/?>/gi;
    let cm: RegExpExecArray | null;
    while ((cm = compRe.exec(inner))) {
      const tag = cm[0];
      components.push({
        objectid: attr(tag, "objectid") ?? "",
        path: tag.match(/\bp:path="([^"]+)"/)?.[1] ?? attr(tag, "path") ?? "",
        transform: attr(tag, "transform") ?? "",
      });
    }
    resObjects.set(id, { components, innerXml: inner });
  }

  const xmlCache = new Map<string, string | null>();
  const loadPathXml = (path: string): string | null => {
    const key = path.replace(/^\//, "");
    if (xmlCache.has(key)) return xmlCache.get(key)!;
    const fileKey = Object.keys(files).find((n) => n.toLowerCase() === key.toLowerCase());
    const xml = fileKey ? strFromU8(files[fileKey]) : null;
    xmlCache.set(key, xml);
    return xml;
  };

  const resolve = (objectid: string, acc: Mat) => {
    const def = resObjects.get(objectid);
    if (!def) return;
    if (def.components.length) {
      for (const c of def.components) {
        const combined = mat4Mul(parseTransform(c.transform), acc);
        const xml = c.path ? loadPathXml(c.path) : null;
        if (xml && xml.includes("<vertex")) out.push({ meshXml: xml, matrix: combined });
      }
    } else if (def.innerXml.includes("<vertex")) {
      out.push({ meshXml: def.innerXml, matrix: acc });
    }
  };

  const buildBlock = rootXml.match(/<build\b[^>]*>([\s\S]*?)<\/build>/i)?.[1] ?? "";
  const itemRe = /<item\b[^>]*\/?>/gi;
  let im: RegExpExecArray | null;
  while ((im = itemRe.exec(buildBlock))) {
    resolve(attr(im[0], "objectid") ?? "", parseTransform(attr(im[0], "transform")));
  }
  return out;
}

export function parseThreeMf(buffer: Uint8Array): ParsedMesh {
  const files = unzipSync(buffer);

  // Resolve the build graph (with transforms). Fall back to every Objects mesh
  // untransformed for atypical files that don't resolve.
  let placements = collectPlacements(files);
  if (!placements.length) {
    for (const name of Object.keys(files)) {
      if (!/3D\/.*\.model$/i.test(name)) continue;
      const xml = strFromU8(files[name]);
      if (xml.includes("<vertex")) placements.push({ meshXml: xml, matrix: IDENTITY.slice() });
    }
  }

  const positions: number[] = [];
  const zoneMap = new Map<string, number[]>();

  for (const { meshXml, matrix } of placements) {
    // Vertices for THIS mesh start at this offset in the combined buffer.
    const baseIndex = positions.length / 3;

    const vtx = meshXml.match(/<vertex\b[^>]*\/?>/g) ?? [];
    for (const v of vtx) {
      const [x, y, z] = applyMat(
        matrix,
        parseFloat(attr(v, "x") ?? "0"),
        parseFloat(attr(v, "y") ?? "0"),
        parseFloat(attr(v, "z") ?? "0")
      );
      positions.push(x, y, z);
    }

    const tris = meshXml.match(/<triangle\b[^>]*\/?>/g) ?? [];
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
