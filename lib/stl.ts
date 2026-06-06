/**
 * Binary STL generator for printOKAY keyring configurator.
 *
 * Produces ONE watertight, manifold STL:
 *   - keyring body  0 → BASE_HEIGHT_MM
 *   - raised text   BASE_HEIGHT_MM → TOTAL_HEIGHT_MM, integrated into the body
 *     (the letters are holes in the body's top face, with side walls rising to
 *      the letter tops — so the whole thing is a single closed surface).
 *
 * For 2-color printing: in BambuStudio add a filament change at Z = BASE_HEIGHT_MM.
 * Everything below = body color, the raised letters above = text color.
 *
 * Coordinate convention: X/Y in mm, Y-up. Outward normals via right-hand CCW.
 *
 * Robustness strategy (this is what eliminates the mesh errors):
 *   1. All contours are cleaned + unioned through clipper-lib first, removing
 *      self-intersections, duplicate points and resolving touching letters.
 *   2. Hole/solid relationships are derived by containment DEPTH (even = solid,
 *      odd = hole), which is orientation-independent and never mis-pairs.
 *   3. Triangulation uses earcut on clean polygons; every vertical edge is
 *      shared by exactly two triangles → manifold.
 */

import type { KeyringConfig, KeyringSizeOption } from "./keyring";
import { getShapePolygon } from "./keyring";
import { extractTextContours, type Point } from "./textpaths";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const ClipperLib = require("clipper-lib");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const earcutMod = require("earcut");
const earcut: (data: number[], holes?: number[], dim?: number) => number[] =
  earcutMod.default ?? earcutMod;

// ─── Print geometry constants ─────────────────────────────────────────────────

const BASE_HEIGHT_MM   = 2.4;  // keyring body height
const TEXT_HEIGHT_MM    = 0.8;  // raised text above body
const TOTAL_HEIGHT_MM   = BASE_HEIGHT_MM + TEXT_HEIGHT_MM;
const HOLE_RADIUS_MM    = 2.5;  // ring attachment hole radius
const TAB_RADIUS_MM     = HOLE_RADIUS_MM + 3.0; // solid nub around the hole
const TAB_CLEARANCE_MM  = 1.0;  // gap between tallest letter and tab circle

const SCALE = 1000; // mm → clipper integer coordinates

// ─── STL types ────────────────────────────────────────────────────────────────

type Vec3 = [number, number, number];
type Tri  = [Vec3, Vec3, Vec3];
type P2   = Point;

// ─── Binary STL encoder ──────────────────────────────────────────────────────

function encodeStl(triangles: Tri[]): Buffer {
  const buf = Buffer.alloc(80 + 4 + triangles.length * 50);
  buf.write("printOKAY Keyring — printokay.dk", 0, "utf8");
  buf.writeUInt32LE(triangles.length, 80);
  let off = 84;
  for (const [a, b, c] of triangles) {
    const ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2];
    const vx = c[0]-a[0], vy = c[1]-a[1], vz = c[2]-a[2];
    let nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    buf.writeFloatLE(nx, off); buf.writeFloatLE(ny, off+4); buf.writeFloatLE(nz, off+8);
    off += 12;
    for (const v of [a, b, c]) {
      buf.writeFloatLE(v[0], off); buf.writeFloatLE(v[1], off+4); buf.writeFloatLE(v[2], off+8);
      off += 12;
    }
    buf.writeUInt16LE(0, off); off += 2;
  }
  return buf;
}

// ─── Polygon math ─────────────────────────────────────────────────────────────

function signedArea(poly: P2[]): number {
  let a = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return a / 2;
}

/** Make polygon CCW (positive shoelace area, Y-up). */
function asCCW(poly: P2[]): P2[] {
  return signedArea(poly) >= 0 ? poly : [...poly].reverse();
}

/** Ray-cast point-in-polygon (excludes vertices/edges ambiguity via half-open test). */
function pointInPolygon(p: P2, poly: P2[]): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if ((yi > p.y) !== (yj > p.y) &&
        p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** A representative interior point of a polygon (centroid fallback to first vertex). */
function samplePoint(poly: P2[]): P2 {
  // Use the average of the first triangle's vertices — robust enough after cleaning.
  if (poly.length >= 3) {
    return {
      x: (poly[0].x + poly[1].x + poly[2].x) / 3,
      y: (poly[0].y + poly[1].y + poly[2].y) / 3,
    };
  }
  return poly[0];
}

// ─── Clipper helpers ──────────────────────────────────────────────────────────

type IPt = { X: number; Y: number };

function toClipper(poly: P2[]): IPt[] {
  return poly.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));
}
function fromClipper(poly: IPt[]): P2[] {
  return poly.map((p) => ({ x: p.X / SCALE, y: p.Y / SCALE }));
}

/**
 * Clean + union a set of contours into well-formed disjoint polygons.
 * Removes self-intersections, duplicate points, and merges touching shapes.
 * Returns mm-space contours (mix of outers and holes, orientation per clipper).
 */
function cleanUnion(contours: P2[][]): P2[][] {
  const paths = contours.filter((c) => c.length >= 3).map(toClipper);
  if (!paths.length) return [];

  const cleaned = ClipperLib.Clipper.CleanPolygons(paths, SCALE * 0.008); // 8µm

  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(cleaned, ClipperLib.PolyType.ptSubject, true);
  const solution: IPt[][] = [];
  clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    solution,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero
  );
  return solution.filter((p) => p.length >= 3).map(fromClipper);
}

/**
 * Offset (expand) a set of contours outward by deltaMm with round joins,
 * then return the unioned outer boundary (single polygon, no holes).
 * This is the "bubble" around the text.
 */
function bubbleAround(contours: P2[][], deltaMm: number): P2[] | null {
  const paths = contours.filter((c) => c.length >= 3).map(toClipper);
  if (!paths.length) return null;

  const co = new ClipperLib.ClipperOffset(2.0, SCALE * 0.05);
  co.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const offset: IPt[][] = [];
  co.Execute(offset, deltaMm * SCALE);
  if (!offset.length) return null;

  // Union the offset pieces and keep only outer boundaries, then the largest.
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(offset, ClipperLib.PolyType.ptSubject, true);
  const union: IPt[][] = [];
  clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    union,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero
  );
  if (!union.length) return null;

  const mm = union.map(fromClipper);
  // Largest by absolute area = the outer shell of the bubble.
  const largest = mm.reduce((a, b) =>
    Math.abs(signedArea(a)) >= Math.abs(signedArea(b)) ? a : b
  );
  return largest;
}

// ─── Containment-depth grouping (orientation-independent) ──────────────────────

type Group = { outer: P2[]; holes: P2[][] };

/**
 * Given clean disjoint contours, group them into solids with their holes by
 * containment depth: depth 0 = solid (letter body), depth 1 = hole (counter),
 * depth 2 = island, etc. Even depth → solid, odd depth → hole of nearest parent.
 */
function groupByDepth(contours: P2[][]): Group[] {
  const n = contours.length;
  const sample = contours.map(samplePoint);
  const area = contours.map((c) => Math.abs(signedArea(c)));

  // depth[i] = number of OTHER contours that contain contour i
  const depth = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (pointInPolygon(sample[i], contours[j])) depth[i]++;
    }
  }

  const groups: Group[] = [];
  const groupIndexOf = new Array(n).fill(-1);

  // Create a group for every even-depth contour (solid)
  for (let i = 0; i < n; i++) {
    if (depth[i] % 2 === 0) {
      groupIndexOf[i] = groups.length;
      groups.push({ outer: contours[i], holes: [] });
    }
  }

  // Assign every odd-depth contour (hole) to the smallest containing solid
  // whose depth is exactly one less.
  for (let i = 0; i < n; i++) {
    if (depth[i] % 2 === 1) {
      let bestSolid = -1;
      let bestArea = Infinity;
      for (let j = 0; j < n; j++) {
        if (depth[j] === depth[i] - 1 &&
            pointInPolygon(sample[i], contours[j]) &&
            area[j] < bestArea) {
          bestArea = area[j];
          bestSolid = j;
        }
      }
      if (bestSolid >= 0) groups[groupIndexOf[bestSolid]].holes.push(contours[i]);
    }
  }

  return groups;
}

// ─── 3D builders ──────────────────────────────────────────────────────────────

/**
 * Triangulate a polygon (CCW outer + CW holes) into flat triangles at height z.
 * up=true → normals +Z (top), up=false → normals −Z (bottom).
 */
function faceTriangles(outer: P2[], holes: P2[][], z: number, up: boolean): Tri[] {
  const ccwOuter = asCCW(outer);
  const cwHoles = holes.map((h) => {
    const ccw = asCCW(h);
    return [...ccw].reverse(); // holes must be opposite winding to outer
  });

  const verts: P2[] = [...ccwOuter];
  const holeStarts: number[] = [];
  for (const h of cwHoles) {
    holeStarts.push(verts.length);
    verts.push(...h);
  }
  const flat = verts.flatMap((p) => [p.x, p.y]);
  const idx = earcut(flat, holeStarts.length ? holeStarts : undefined);

  const tris: Tri[] = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = verts[idx[i]], b = verts[idx[i+1]], c = verts[idx[i+2]];
    if (up) tris.push([[a.x,a.y,z],[b.x,b.y,z],[c.x,c.y,z]]);
    else    tris.push([[c.x,c.y,z],[b.x,b.y,z],[a.x,a.y,z]]);
  }
  return tris;
}

/**
 * Vertical side wall along a polygon perimeter, from zBottom to zTop.
 * outward=true → normals point away from the polygon interior (for solid edges).
 * outward=false → normals point into the interior (for cavity / hole edges).
 * Pass any winding; we normalize to CCW and flip as needed.
 */
function wall(poly: P2[], zBottom: number, zTop: number, outward: boolean): Tri[] {
  const ccw = asCCW(poly);
  const tris: Tri[] = [];
  const n = ccw.length;
  for (let i = 0; i < n; i++) {
    const a = ccw[i], b = ccw[(i + 1) % n];
    if (outward) {
      tris.push([[a.x,a.y,zBottom],[b.x,b.y,zBottom],[b.x,b.y,zTop]]);
      tris.push([[a.x,a.y,zBottom],[b.x,b.y,zTop],  [a.x,a.y,zTop]]);
    } else {
      tris.push([[b.x,b.y,zBottom],[a.x,a.y,zBottom],[a.x,a.y,zTop]]);
      tris.push([[b.x,b.y,zBottom],[a.x,a.y,zTop],  [b.x,b.y,zTop]]);
    }
  }
  return tris;
}

// ─── T-junction repair ────────────────────────────────────────────────────────

/**
 * Earcut can connect collinear boundary points across gaps (e.g. letters whose
 * bottoms all sit on the baseline), producing a long edge that skips vertices
 * the walls actually use → a T-junction → a tiny gap (open boundary edge).
 *
 * This pass splits any triangle edge that has another mesh vertex lying strictly
 * on it, until no such T-junctions remain. The result is fully watertight
 * regardless of how earcut chose to triangulate.
 */
function repairTJunctions(tris: Tri[]): Tri[] {
  const Q = 1e5;
  const q = (x: number) => Math.round(x * Q) / Q;
  const keyOf = (p: Vec3) => `${q(p[0])},${q(p[1])},${q(p[2])}`;

  // Canonicalize vertices to integer ids
  const vmap = new Map<string, number>();
  const verts: Vec3[] = [];
  const canon = (p: Vec3): number => {
    const k = keyOf(p);
    let id = vmap.get(k);
    if (id === undefined) { id = verts.length; verts.push([q(p[0]), q(p[1]), q(p[2])]); vmap.set(k, id); }
    return id;
  };
  let triIds: [number, number, number][] = tris.map((t) => [canon(t[0]), canon(t[1]), canon(t[2])]);

  // Integer (micro-unit) coords for EXACT collinearity tests — no epsilon fuzz,
  // so curve points that merely pass near an edge are never mistaken for a
  // T-junction. Only genuinely collinear shared vertices (e.g. letters whose
  // bottoms lie on the same baseline) are split.
  const IX = verts.map((v) => [Math.round(v[0]*Q), Math.round(v[1]*Q), Math.round(v[2]*Q)]);

  // Bucket vertex ids by integer z — every T-junction in this mesh lies on a
  // horizontal edge (floors/tops). Vertical wall edges span two z levels and
  // never carry an interior vertex.
  const byZ = new Map<number, number[]>();
  IX.forEach((v, i) => {
    const arr = byZ.get(v[2]);
    if (arr) arr.push(i); else byZ.set(v[2], [i]);
  });

  /** All mesh vertices lying EXACTLY on horizontal edge (i→j), sorted by param. */
  const interiorOnEdge = (i: number, j: number): number[] => {
    const A = IX[i], B = IX[j];
    if (A[2] !== B[2]) return []; // horizontal edges only
    const abx = B[0]-A[0], aby = B[1]-A[1];
    const ab2 = abx*abx + aby*aby;
    if (ab2 === 0) return [];
    const cand = byZ.get(A[2]) ?? [];
    const hits: { vid: number; t: number }[] = [];
    for (const k of cand) {
      if (k === i || k === j) continue;
      const P = IX[k];
      const cross = abx*(P[1]-A[1]) - aby*(P[0]-A[0]);
      if (cross !== 0) continue; // not exactly collinear
      const dot = (P[0]-A[0])*abx + (P[1]-A[1])*aby;
      if (dot <= 0 || dot >= ab2) continue; // strictly between endpoints
      hits.push({ vid: k, t: dot / ab2 });
    }
    hits.sort((a, b) => a.t - b.t);
    return hits.map((h) => h.vid);
  };

  // Repeatedly subdivide. Resolving ALL interior points of one edge in a single
  // fan (from the opposite corner) keeps both sides of a shared edge identical,
  // so the mesh converges to watertight without slivers.
  let changed = true, guard = 0;
  while (changed && guard++ < 16) {
    changed = false;
    const out: [number, number, number][] = [];
    for (const tri of triIds) {
      let split = false;
      for (let e = 0; e < 3 && !split; e++) {
        const a = tri[e], b = tri[(e + 1) % 3], c = tri[(e + 2) % 3];
        const inner = interiorOnEdge(a, b);
        if (inner.length) {
          const chain = [a, ...inner, b];
          for (let m = 0; m < chain.length - 1; m++) {
            out.push([chain[m], chain[m + 1], c]); // preserves original winding
          }
          split = true;
          changed = true;
        }
      }
      if (!split) out.push(tri);
    }
    triIds = out;
  }

  return triIds.map((t) => [verts[t[0]], verts[t[1]], verts[t[2]]] as Tri);
}

// ─── Circle helper ────────────────────────────────────────────────────────────

function circle(cx: number, cy: number, r: number, steps = 64): P2[] {
  return Array.from({ length: steps }, (_, i) => {
    const t = (i / steps) * 2 * Math.PI;
    return { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) };
  });
}

// ─── Main STL generator ───────────────────────────────────────────────────────

export async function generateKeyringStl(
  config: KeyringConfig,
  size: KeyringSizeOption
): Promise<Buffer> {

  // 1. Extract + clean text geometry (raw font outlines → disjoint polygons)
  const fontSize = config.fontSize > 0
    ? config.fontSize
    : Math.min(size.widthMm, size.heightMm) * 0.5;

  const rawContours = extractTextContours(config.text, config.font, fontSize);
  const inkContours = cleanUnion(rawContours);     // clean, disjoint letter polygons
  const allGroups   = groupByDepth(inkContours);   // {outer, holes}[] per letter

  // 2. Determine the body outline + ring-hole position
  let body: P2[];
  let holeCX: number, holeCY: number;
  const holePosition = config.holePosition ?? "top";

  if (config.shapeType === "auto" && allGroups.length) {
    const allPts = allGroups.flatMap((g) => g.outer);

    if (holePosition === "side") {
      // Tab hangs to the LEFT of the leftmost letter, vertically centered on text.
      const leftX  = Math.min(...allPts.map((p) => p.x));
      const minY   = Math.min(...allPts.map((p) => p.y));
      const maxY   = Math.max(...allPts.map((p) => p.y));
      holeCX = leftX - TAB_CLEARANCE_MM - TAB_RADIUS_MM;
      holeCY = (minY + maxY) / 2;
    } else {
      // Tab floats ABOVE the tallest letter so the hole never hits text.
      const topY = Math.max(...allPts.map((p) => p.y));
      holeCX = 0;
      holeCY = topY + TAB_CLEARANCE_MM + TAB_RADIUS_MM;
    }

    const tab = circle(holeCX, holeCY, TAB_RADIUS_MM);
    const marginMm = Math.min(size.widthMm, size.heightMm) * 0.16;
    const bubble = bubbleAround([...allGroups.map((g) => g.outer), tab], marginMm);
    body = bubble ?? getShapePolygon("auto", size.widthMm, size.heightMm);
  } else {
    // Heart / oval / fallback: fixed template.
    body = getShapePolygon(config.shapeType, size.widthMm, size.heightMm);
    if (holePosition === "side") {
      // Place hole near the left edge of the template shape.
      const leftX = Math.min(...body.map((p) => p.x));
      holeCX = leftX + HOLE_RADIUS_MM + 2.5;
      holeCY = 0;
    } else {
      const topY = Math.max(...body.map((p) => p.y));
      holeCX = 0;
      holeCY = topY - HOLE_RADIUS_MM - 2.5;
    }
  }

  const ringHole = circle(holeCX, holeCY, HOLE_RADIUS_MM);

  // Safety: only carve/raise letters that actually lie within the body outline.
  // (Auto: always true by construction. Heart/oval: drops any glyph that would
  //  fall outside the template, which would otherwise break the triangulation.)
  const inkGroups = allGroups.filter((g) => pointInPolygon(samplePoint(g.outer), body));
  const inkOuters = inkGroups.map((g) => g.outer);
  const inkHoles  = inkGroups.flatMap((g) => g.holes);

  // 3. Assemble one watertight manifold.
  const tris: Tri[] = [];

  // 3a. Body BOTTOM at z=0: full body minus the ring hole (normals down).
  tris.push(...faceTriangles(body, [ringHole], 0, false));

  // 3b. Body OUTER wall 0 → BASE (outward normals).
  tris.push(...wall(body, 0, BASE_HEIGHT_MM, true));

  // 3c. Ring-hole wall 0 → BASE (inward normals = cavity).
  tris.push(...wall(ringHole, 0, BASE_HEIGHT_MM, false));

  // 3d. Body TOP at z=BASE: body minus ring hole minus letter footprints,
  //     PLUS counter islands (base shows through the holes of 'O', 'A', …).
  //     Letter outers become holes here; counters are added back as patches.
  tris.push(...faceTriangles(body, [ringHole, ...inkOuters], BASE_HEIGHT_MM, true));
  for (const counter of inkHoles) {
    tris.push(...faceTriangles(counter, [], BASE_HEIGHT_MM, true));
  }

  // 3e. Letter walls BASE → TOTAL: outer perimeters (outward) and counters (inward).
  for (const outer of inkOuters) {
    tris.push(...wall(outer, BASE_HEIGHT_MM, TOTAL_HEIGHT_MM, true));
  }
  for (const counter of inkHoles) {
    tris.push(...wall(counter, BASE_HEIGHT_MM, TOTAL_HEIGHT_MM, false));
  }

  // 3f. Letter TOPS at z=TOTAL: each letter group (outer with its counters), up.
  for (const g of inkGroups) {
    tris.push(...faceTriangles(g.outer, g.holes, TOTAL_HEIGHT_MM, true));
  }

  // 4. Repair any T-junctions earcut may have introduced → fully watertight.
  return encodeStl(repairTJunctions(tris));
}
