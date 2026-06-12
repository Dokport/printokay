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
 * Tessellate a Bambu/Prusa per-triangle `paint_color` into coloured sub-triangles.
 * The attribute is a bit-packed PrusaSlicer `TriangleSelector` subdivision tree:
 *
 *  - nibbles are stored in REVERSE order, each read LSB-first
 *  - per node: bits 0-1 = number of split edges. 0 → a leaf; 1/2/3 → that many+1
 *    children. For a leaf, bits 2-3 hold the state; for a split, the "special side".
 *  - a leaf state of 0/1/2 sits in bits 2-3; 0b11 escapes to the next nibble
 *    (state = nibble+3, and 0b1110 escapes again to an 8-bit state)
 *  - state 0 → "use the object's own extruder"; state N (≥1) → extruder N
 *  - children are serialised in REVERSE index order (child[n]…child[0])
 *
 * Splitting adds edge-midpoint vertices and recurses exactly like the slicer, so a
 * colour boundary lands on the right geometry (the right layer) instead of snapping
 * to whole triangles. `midpoint(i,j)` allocates/returns a shared midpoint vertex;
 * `emit(ext,a,b,c)` receives each final coloured sub-triangle.
 *
 * Subdivision (rotated so `special` is the canonical side; A,B,C = rotated corners):
 *   1 split: edge B–C → [A,B,Mbc] [Mbc,C,A]
 *   2 split: edges A–B, A–C → [A,Mab,Mac] [Mab,B,Mac] [B,C,Mac]
 *   3 split: all edges → [A,Mab,Mac] [Mab,B,Mbc] [Mbc,C,Mac] [Mab,Mbc,Mac]
 */
function tessellatePaint(
  hex: string,
  g0: number, g1: number, g2: number,
  objExt: number,
  midpoint: (i: number, j: number) => number,
  emit: (ext: number, a: number, b: number, c: number) => void
): void {
  const bits: number[] = [];
  for (let i = hex.length - 1; i >= 0; i--) {
    const v = parseInt(hex[i], 16);
    if (Number.isNaN(v)) continue;
    bits.push(v & 1, (v >> 1) & 1, (v >> 2) & 1, (v >> 3) & 1);
  }
  const readNibble = (i: number): [number, number] => {
    let n = 0;
    for (let k = 0; k < 4; k++) n |= (bits[i++] || 0) << k;
    return [n, i];
  };
  // Peek the subtree at `start`: how many DISTINCT states it contains, its dominant
  // state, and the cursor after it — all without touching geometry. Uniform subtrees
  // (the vast majority — solid regions, even when deeply encoded) collapse to a single
  // triangle, so we only ever subdivide along actual colour boundaries.
  const peek = (start: number): { distinct: number; dominant: number; end: number } => {
    let i = start;
    const counts = new Map<number, number>(); // keyed by resolved EXTRUDER
    const bump = (ext: number) => counts.set(ext, (counts.get(ext) ?? 0) + 1);
    const walk = () => {
      if (i + 4 > bits.length) { bump(objExt); return; }
      let code: number; [code, i] = readNibble(i);
      const split = code & 0b11;
      if (split !== 0) { for (let c = 0; c <= split; c++) walk(); return; }
      const hi = (code >> 2) & 0b11;
      let state: number;
      if (hi !== 0b11) state = hi;
      else { let s2: number; [s2, i] = readNibble(i); if (s2 !== 0b1110) state = s2 + 3; else { let v = 0; for (let k = 0; k < 8; k++) v |= (bits[i++] || 0) << k; state = v + 17; } }
      bump(state === 0 ? objExt : state); // state 0 → object's own extruder
    };
    walk();
    let dominant = objExt, dn = -1;
    for (const [ext, n] of counts) if (n > dn) { dn = n; dominant = ext; }
    return { distinct: counts.size, dominant, end: i };
  };

  // Cap subdivision depth: each level refines a colour boundary 2× finer. Bambu can
  // paint boundaries dozens of levels deep, which would explode into 100k+ triangles
  // per model — far too heavy for a web preview. 3 levels (8× finer than whole-triangle
  // colouring) tracks the real boundary closely while keeping the mesh light. Beyond
  // the cap a sub-triangle takes its dominant colour.
  const MAX_DEPTH = 3;
  let ibit = 0;
  const node = (a: number, b: number, c: number, depth: number) => {
    if (ibit + 4 > bits.length) { emit(objExt, a, b, c); return; }
    const { distinct, dominant, end } = peek(ibit);
    if (distinct <= 1 || depth >= MAX_DEPTH) {
      // Uniform region (or depth cap) → one triangle with the (dominant) extruder.
      ibit = end;
      emit(dominant, a, b, c);
      return;
    }
    // Mixed subtree → read this node's header and subdivide along the boundary.
    let code: number; [code, ibit] = readNibble(ibit);
    const split = code & 0b11;
    const special = ((code >> 2) & 0b11) % 3;
    const V = [a, b, c];
    const A = V[special], B = V[(special + 1) % 3], C = V[(special + 2) % 3];
    let children: [number, number, number][];
    if (split === 1) {
      const Mbc = midpoint(B, C);
      children = [[A, B, Mbc], [Mbc, C, A]];
    } else if (split === 2) {
      const Mab = midpoint(A, B), Mac = midpoint(A, C);
      children = [[A, Mab, Mac], [Mab, B, Mac], [B, C, Mac]];
    } else {
      const Mab = midpoint(A, B), Mbc = midpoint(B, C), Mac = midpoint(A, C);
      children = [[A, Mab, Mac], [Mab, B, Mbc], [Mbc, C, Mac], [Mab, Mbc, Mac]];
    }
    // Children are serialised high index → low, so recurse in that same order.
    for (let k = children.length - 1; k >= 0; k--) node(children[k][0], children[k][1], children[k][2], depth + 1);
  };
  node(g0, g1, g2, 0);
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
  // Group triangles by their decoded extruder → one zone per real colour. Painted
  // triangles are tessellated (boundary triangles split into coloured sub-triangles),
  // so both the zone count and the colour boundaries are exact — no guessing.
  const groups = new Map<number, number[]>(); // extruder → vertex indices
  const add = (ext: number, a: number, b: number, c: number) => {
    let arr = groups.get(ext);
    if (!arr) groups.set(ext, (arr = []));
    arr.push(a, b, c);
  };
  // Shared edge-midpoint cache, so subdivided neighbours stay watertight (no cracks).
  const midCache = new Map<string, number>();
  const midpoint = (i: number, j: number): number => {
    const key = i < j ? `${i},${j}` : `${j},${i}`;
    const hit = midCache.get(key);
    if (hit != null) return hit;
    const m = positions.length / 3;
    positions.push(
      Math.round((positions[i * 3] + positions[j * 3]) / 2 * 1000) / 1000,
      Math.round((positions[i * 3 + 1] + positions[j * 3 + 1]) / 2 * 1000) / 1000,
      Math.round((positions[i * 3 + 2] + positions[j * 3 + 2]) / 2 * 1000) / 1000,
    );
    midCache.set(key, m);
    return m;
  };

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
      const g0 = baseIndex + v1, g1 = baseIndex + v2, g2 = baseIndex + v3;
      const pc = attr(t, "paint_color");
      if (pc) tessellatePaint(pc, g0, g1, g2, extruder, midpoint, add);
      else add(extruder, g0, g1, g2);
    }
  }

  // One zone per extruder, keyed `e<extruder>`, coloured from the filament list.
  const modelColors = extractModelColors(files);
  const zones: MeshZone[] = [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ext, indices]) => ({ key: `e${ext}`, indices, color: modelColors[ext - 1] }));

  return { positions, zones };
}
