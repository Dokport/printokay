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

export type SlicedFilament = { type: string; color: string; usedGrams: number };
export type SlicedStats = {
  printMinutes?: number;
  filamentGrams?: number;
  filaments: SlicedFilament[];
};

/**
 * Extract print estimates from a sliced .gcode.3mf's `slice_info.config`:
 * `prediction` (print time, seconds), `weight` (filament grams) and the
 * per-filament `used_g`/`type`/`color`. Returns null for an unsliced project file.
 */
export function parseSlicedStats(buffer: Uint8Array): SlicedStats | null {
  const files = unzipSync(buffer);
  const si = Object.keys(files).find((n) => /slice_info\.config$/i.test(n));
  if (!si) return null;
  const xml = strFromU8(files[si]);

  const sum = (re: RegExp): number | undefined => {
    let total = 0, found = false;
    let m: RegExpExecArray | null;
    const g = new RegExp(re.source, "gi");
    while ((m = g.exec(xml))) { total += Number(m[1]) || 0; found = true; }
    return found ? total : undefined;
  };

  const predictionSec = sum(/key="prediction"[^>]*value="([\d.]+)"/);
  if (predictionSec == null) return null; // not sliced

  const weightG = sum(/key="weight"[^>]*value="([\d.]+)"/);

  const filaments: SlicedFilament[] = [];
  const fre = /<filament\b[^>]*\/?>/gi;
  let fm: RegExpExecArray | null;
  while ((fm = fre.exec(xml))) {
    const tag = fm[0];
    const used = Number(attr(tag, "used_g"));
    if (!used) continue;
    filaments.push({
      type: attr(tag, "type") ?? "",
      color: normHex(attr(tag, "color") ?? "#888888"),
      usedGrams: used,
    });
  }

  return {
    printMinutes: Math.round(predictionSec / 60),
    filamentGrams: weightG != null ? Math.round(weightG * 100) / 100 : undefined,
    filaments,
  };
}

// Squared RGB distance between two "#RRGGBB" colours (cheap nearest-colour metric).
function colorDist(a: string, b: string): number {
  const rgb = (h: string) => {
    const x = h.replace(/^#/, "");
    return [parseInt(x.slice(0, 2), 16) || 0, parseInt(x.slice(2, 4), 16) || 0, parseInt(x.slice(4, 6), 16) || 0];
  };
  const [r1, g1, b1] = rgb(a), [r2, g2, b2] = rgb(b);
  return (r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2;
}

/**
 * Reconcile a model's geometric mesh zones with the filaments actually used in the
 * sliced file (the authoritative colour list). Produces one customer-facing colour
 * slot per used filament, and maps every mesh zone onto a slot:
 *
 *  - zones with a reliable colour (the unpainted `e<extruder>` regions) → the slot
 *    whose filament colour is nearest.
 *  - painted `p<…>` zones (colour unknown — paint_color is lossy) → the remaining
 *    filaments by descending usage, matched by descending zone area. Leftover zones
 *    fall back to the most-used slot.
 *
 * This keeps the colour COUNT correct (it always equals the sliced filament count)
 * regardless of how the paint_color tree happens to encode the boundaries.
 */
export function mapZonesToFilaments(
  zones: MeshZone[],
  filaments: SlicedFilament[]
): { slots: { id: string; label: string }[]; colorZones: { key: string; slotId: string; color?: string }[] } {
  const used = filaments.filter((f) => f.usedGrams > 0);
  if (!used.length) {
    // No sliced data — fall back to one slot per mesh zone.
    const slots = zones.map((_, i) => ({ id: `slot-${i + 1}`, label: `Farve ${i + 1}` }));
    return { slots, colorZones: zones.map((z, i) => ({ key: z.key, slotId: `slot-${i + 1}`, color: z.color })) };
  }

  // One slot per used filament, ordered by descending usage (biggest area first).
  const F = [...used].sort((a, b) => b.usedGrams - a.usedGrams);
  const slots = F.map((_, i) => ({ id: `slot-${i + 1}`, label: `Farve ${i + 1}` }));

  const colorZones: { key: string; slotId: string; color?: string }[] = [];
  const claimed = new Set<number>();

  // Colour-bearing (unpainted) zones → nearest filament by colour.
  const coloured = zones.filter((z) => z.color).sort((a, b) => b.indices.length - a.indices.length);
  for (const z of coloured) {
    let best = 0, bd = Infinity;
    F.forEach((f, i) => { const d = colorDist(z.color!, f.color); if (d < bd) { bd = d; best = i; } });
    claimed.add(best);
    colorZones.push({ key: z.key, slotId: slots[best].id, color: F[best].color });
  }

  // Painted zones (colour unknown) → remaining filaments by usage, biggest zone first.
  const painted = zones.filter((z) => !z.color).sort((a, b) => b.indices.length - a.indices.length);
  const remaining = F.map((_, i) => i).filter((i) => !claimed.has(i));
  for (const z of painted) {
    const idx = remaining.length ? remaining.shift()! : 0; // fall back to the biggest slot
    claimed.add(idx);
    colorZones.push({ key: z.key, slotId: slots[idx].id, color: F[idx].color });
  }

  return { slots, colorZones };
}

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
 * Bambu/Prusa store per-triangle MMU painting in `paint_color` as a bit-packed
 * subdivision tree, NOT a plain colour id:
 *  - a triangle painted one solid colour gets a SHORT code ("4", "8", "1C", …)
 *  - a triangle straddling a colour boundary is subdivided and gets a LONG,
 *    near-unique encoded string ("441C443443", …)
 *
 * A model can therefore have only a handful of real colours but hundreds of
 * distinct boundary codes (894 for this 4-colour hedgehog). Grouping by the raw
 * string explodes into bogus zones. We instead treat short codes as solid colours
 * and long codes as boundaries (folded into the dominant colour — a thin seam, so
 * the visual cost is negligible while the colour *count* is correct).
 *
 * Rather than decode the (sparse, AMS-slot-dependent) absolute extruder number, we
 * rank the solid codes that actually appear and map them DENSELY onto the model's
 * filament list, so N painted colours always yield exactly N zones in file order.
 */
const isSolidPaintCode = (c: string) => c.length <= 2; // boundary/split codes are longer

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

// If the project has a plate named "Show", the shop renders only that plate's
// objects — letting you pose (and optionally lighten) a dedicated display layout
// in the same Bambu project, separate from the print plate(s).
const SHOW_PLATE_NAME = "show";

// Per-object extruder/filament assignment from model_settings.config. Used to
// colour models that are multi-colour *per object* (e.g. multi-part prints) rather
// than via per-triangle paint.
function objectExtruders(files: Record<string, Uint8Array>): Map<string, number> {
  const m = new Map<string, number>();
  const msName = Object.keys(files).find((n) => /model_settings\.config$/i.test(n));
  if (!msName) return m;
  const xml = strFromU8(files[msName]);
  const objRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/gi;
  let om: RegExpExecArray | null;
  while ((om = objRe.exec(xml))) {
    const id = om[1].match(/\bid="([^"]+)"/)?.[1];
    if (!id) continue;
    const ext = om[2].match(/key="extruder"[^>]*value="(\d+)"/i)?.[1];
    if (ext) m.set(id, Number(ext));
  }
  return m;
}

function showPlateObjectIds(files: Record<string, Uint8Array>): Set<string> | null {
  const msName = Object.keys(files).find((n) => /model_settings\.config$/i.test(n));
  if (!msName) return null;
  const xml = strFromU8(files[msName]);
  const plateRe = /<plate>([\s\S]*?)<\/plate>/gi;
  let pm: RegExpExecArray | null;
  while ((pm = plateRe.exec(xml))) {
    const block = pm[1];
    const name = block.match(/key="plater_name"[^>]*value="([^"]*)"/i)?.[1]?.trim().toLowerCase();
    if (name !== SHOW_PLATE_NAME) continue;
    const ids = new Set<string>();
    const instRe = /<model_instance>([\s\S]*?)<\/model_instance>/gi;
    let mi: RegExpExecArray | null;
    while ((mi = instRe.exec(block))) {
      const oid = mi[1].match(/key="object_id"[^>]*value="([^"]*)"/i)?.[1];
      if (oid) ids.add(oid);
    }
    return ids.size ? ids : null;
  }
  return null;
}

/**
 * Resolve the build graph (3dmodel.model `<build><item>` → resource objects →
 * `<component>` paths to Objects/*.model) into a flat list of meshes, each with
 * its composed world transform. This places multi-object models correctly
 * (matching the build plate / posed layout) instead of stacking them at origin.
 *
 * If a plate named "Show" exists, only its objects are included.
 */
type Placement = { meshXml: string; matrix: Mat; extruder: number };

function collectPlacements(files: Record<string, Uint8Array>): Placement[] {
  const out: Placement[] = [];
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

  const resolve = (objectid: string, acc: Mat, extruder: number) => {
    const def = resObjects.get(objectid);
    if (!def) return;
    if (def.components.length) {
      for (const c of def.components) {
        const combined = mat4Mul(parseTransform(c.transform), acc);
        const xml = c.path ? loadPathXml(c.path) : null;
        if (xml && xml.includes("<vertex")) out.push({ meshXml: xml, matrix: combined, extruder });
      }
    } else if (def.innerXml.includes("<vertex")) {
      out.push({ meshXml: def.innerXml, matrix: acc, extruder });
    }
  };

  const showOnly = showPlateObjectIds(files); // null → all plates
  const extruders = objectExtruders(files);

  const buildBlock = rootXml.match(/<build\b[^>]*>([\s\S]*?)<\/build>/i)?.[1] ?? "";
  const itemRe = /<item\b[^>]*\/?>/gi;
  let im: RegExpExecArray | null;
  while ((im = itemRe.exec(buildBlock))) {
    const objectid = attr(im[0], "objectid") ?? "";
    if (showOnly && !showOnly.has(objectid)) continue; // keep only the "Show" plate
    resolve(objectid, parseTransform(attr(im[0], "transform")), extruders.get(objectid) ?? 1);
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
      if (xml.includes("<vertex")) placements.push({ meshXml: xml, matrix: IDENTITY.slice(), extruder: 1 });
    }
  }

  const positions: number[] = [];
  // First pass: classify each triangle.
  //  - unpainted          → its object's extruder (reliable colour via filament list)
  //  - painted solid code → the short code's numeric value (an opaque region id)
  //  - painted long code  → a colour *boundary* (null), folded into the dominant zone
  // We deliberately do NOT derive the colour COUNT from paint_color: it's a lossy,
  // base-relative encoding. The sliced file's filament list is the source of truth
  // for how many colours there are; the admin maps these geometric zones onto it.
  type Tri = { a: number; b: number; c: number; ext: number; paint: number | null; painted: boolean };
  const tris: Tri[] = [];

  for (const { meshXml, matrix, extruder } of placements) {
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
      // Round to µm — plenty for display, and shrinks the cached/transferred JSON.
      positions.push(Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000, Math.round(z * 1000) / 1000);
    }

    const tlist = meshXml.match(/<triangle\b[^>]*\/?>/g) ?? [];
    for (const t of tlist) {
      const v1 = parseInt(attr(t, "v1") ?? "", 10);
      const v2 = parseInt(attr(t, "v2") ?? "", 10);
      const v3 = parseInt(attr(t, "v3") ?? "", 10);
      if (Number.isNaN(v1) || Number.isNaN(v2) || Number.isNaN(v3)) continue;
      const pc = attr(t, "paint_color");
      const painted = !!pc;
      const paint = pc ? (isSolidPaintCode(pc) ? parseInt(pc, 16) : null) : null;
      tris.push({ a: baseIndex + v1, b: baseIndex + v2, c: baseIndex + v3, ext: extruder, paint, painted });
    }
  }

  // Group triangles into zones:
  //  - unpainted  → key `e<extruder>` (colour = filament list entry — RELIABLE)
  //  - painted    → key `p<value>`    (colour resolved later from the sliced file)
  const groups = new Map<string, number[]>();
  const add = (key: string, t: Tri) => {
    let arr = groups.get(key);
    if (!arr) groups.set(key, (arr = []));
    arr.push(t.a, t.b, t.c);
  };
  const boundary: Tri[] = [];
  for (const t of tris) {
    if (!t.painted) add(`e${t.ext}`, t);
    else if (t.paint != null) add(`p${t.paint}`, t);
    else boundary.push(t); // long boundary code → fold into the dominant zone below
  }
  // Fold boundary triangles into whichever zone is largest (the seam is thin).
  let domKey = "e1", domSize = -1;
  for (const [k, arr] of groups) if (arr.length > domSize) { domSize = arr.length; domKey = k; }
  for (const t of boundary) add(domKey, t);

  const modelColors = extractModelColors(files);
  const zones: MeshZone[] = [...groups.entries()].map(([key, indices]) => {
    const em = key.match(/^e(\d+)$/);
    const color = em ? modelColors[Number(em[1]) - 1] : undefined;
    return { key, indices, color };
  });

  return { positions, zones };
}
