/**
 * Isomorphic keyring geometry core (NO Node.js APIs — runs on server AND in browser).
 *
 * Turns raw 2D text contours (from opentype.js, mm units, Y-up) into a watertight
 * 3D triangle mesh, split into two groups by Z-height so they can be printed /
 * rendered in two colors:
 *
 *   - base : keyring body          0 → BASE_HEIGHT_MM
 *   - text : raised letters        BASE_HEIGHT_MM → TOTAL_HEIGHT_MM
 *
 * Both the server STL encoder (lib/stl.ts) and the client 3D preview
 * (components/KeyringPreview3D.tsx) consume `buildKeyringMesh`. Keeping this code
 * shared guarantees the preview matches the printed STL exactly.
 *
 * Coordinate convention: X/Y in mm, Y-up. Outward normals via right-hand CCW.
 *
 * Robustness strategy (this is what eliminates mesh errors):
 *   1. All contours are cleaned + unioned through clipper-lib first, removing
 *      self-intersections, duplicate points and resolving touching letters.
 *   2. Hole/solid relationships are derived by containment DEPTH (even = solid,
 *      odd = hole), which is orientation-independent and never mis-pairs.
 *   3. Triangulation uses earcut on clean polygons; every vertical edge is
 *      shared by exactly two triangles → manifold.
 */

import ClipperLib from "clipper-lib";
import earcutMod from "earcut";
import type { KeyringConfig, KeyringSizeOption } from "./keyring";
import { getShapePolygon, capHeightOf, lineCapHeight, plateSizeFor, templateUsesTab } from "./keyring";
import type { Point } from "./textpaths";
import { splitTextLines } from "./textpaths";

const earcut: (data: number[], holes?: number[], dim?: number) => number[] =
  // earcut ships as CJS; the default export is the function.
  (earcutMod as unknown as { default?: typeof earcutMod }).default ?? earcutMod;

// ─── Print geometry constants ─────────────────────────────────────────────────

export const BASE_HEIGHT_MM   = 3.0;  // keyring body height
export const TEXT_HEIGHT_MM    = 1.2;  // raised text above body
export const TOTAL_HEIGHT_MM   = BASE_HEIGHT_MM + TEXT_HEIGHT_MM; // 4.2mm incl. text
const HOLE_RADIUS_MM    = 2.5;  // ring attachment hole radius
const TAB_RADIUS_MM     = HOLE_RADIUS_MM + 1.8; // solid nub around the hole (wall ≈1.8mm)
const TAB_CLEARANCE_MM  = 1.0;  // gap between tallest letter and tab circle
/**
 * Narrowest the material joining two lines of text may end up, once bubbled. Set a
 * little above the width actually wanted: the bubble's round joins shave roughly a
 * millimetre off the bridge where it meets the gap, so asking for exactly the target
 * lands just under it.
 */
const MIN_LINE_BRIDGE_MM = 10.5;

// The oval's eye carries the whole tag on a split ring, and PLA splits along its
// layer lines, so it gets a beefier version of the tab than the "auto" shape: a
// 3mm wall instead of 1.8mm, pulled in close so it sits on a stub rather than a
// stalk, and joined with a generous fillet — a sharp inside corner there is where
// a printed part cracks first.
const OVAL_TAB_RADIUS_MM     = HOLE_RADIUS_MM + 3.8; // 3.8mm wall around the hole
const OVAL_TAB_BLEND_MM      = 3.0;  // fillet radius where the eye meets the plate
/**
 * How far the eye sticks out past the plate. The hole is sunk INTO the oval until
 * only this much of the surrounding boss protrudes, so most of the material around
 * the hole is plate body rather than an added lug — strong, but barely a bump. The
 * wall stays OVAL_TAB_RADIUS_MM − HOLE_RADIUS_MM whatever this is set to; lowering
 * it only trades protrusion for headroom above the lettering.
 */
const OVAL_TAB_PROTRUSION_MM = 5.5;

const SCALE = 1000; // mm → clipper integer coordinates

// ─── Mesh types ───────────────────────────────────────────────────────────────

export type Vec3 = [number, number, number];
export type Tri  = [Vec3, Vec3, Vec3];
export type KeyringMesh = {
  base: Tri[];
  text: Tri[];
  /** Ring-attachment hole, so a preview can thread a split ring through it. */
  hole: { cx: number; cy: number; r: number };
  /**
   * Plate footprint in mm², hole already subtracted. This is what the keyring
   * costs to make — print time on a flat part tracks area almost exactly — so it
   * is what the price is worked out from, rather than the size label.
   */
  areaMm2: number;
  /**
   * What the incoming lettering was multiplied by to land on the target area. The
   * configurator turns this into the achieved letter height, which is how it knows
   * when a name has stopped fitting.
   */
  textScale: number;
};
type P2 = Point;

// ─── Polygon math ─────────────────────────────────────────────────────────────

export function signedArea(poly: P2[]): number {
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

/** Ray-cast point-in-polygon. */
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

/** A representative interior point of a polygon. */
function samplePoint(poly: P2[]): P2 {
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
 * Offset (expand) a set of contours outward by deltaMm with round joins, then union.
 * Returns every resulting OUTER island, largest first.
 */
function bubbleIslands(contours: P2[][], deltaMm: number): P2[][] {
  const paths = contours.filter((c) => c.length >= 3).map(toClipper);
  if (!paths.length) return [];

  const co = new ClipperLib.ClipperOffset(2.0, SCALE * 0.05);
  co.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const offset: IPt[][] = [];
  co.Execute(offset, deltaMm * SCALE);
  if (!offset.length) return [];

  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(offset, ClipperLib.PolyType.ptSubject, true);
  const union: IPt[][] = [];
  clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    union,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero
  );
  if (!union.length) return [];

  const mm = union.map(fromClipper).filter((p) => p.length >= 3);
  const outers = mm.filter((p) => signedArea(p) > 0); // drop hole rings
  return (outers.length ? outers : mm).sort(
    (a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a))
  );
}

/**
 * The plate outline: the bubble around everything, grown until it forms ONE island.
 *
 * Widely-spaced glyphs (short text scaled up to the advertised width) can sit further
 * apart than the margin, which would split the plate into islands — and since only one
 * can be the body, the ring tab or whole letters would silently disappear. Growing the
 * margin fattens the plate until it closes into a single, printable piece.
 */
function bubbleAround(contours: P2[][], deltaMm: number): P2[] | null {
  let delta = deltaMm;
  let best: P2[] | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const islands = bubbleIslands(contours, delta);
    if (!islands.length) break;
    best = islands[0];
    if (islands.length === 1) return best;
    delta *= 1.35;
  }
  return best;
}

// ─── Containment-depth grouping (orientation-independent) ──────────────────────

type Group = { outer: P2[]; holes: P2[][] };

function groupByDepth(contours: P2[][]): Group[] {
  const n = contours.length;
  const sample = contours.map(samplePoint);
  const area = contours.map((c) => Math.abs(signedArea(c)));

  const depth = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (pointInPolygon(sample[i], contours[j])) depth[i]++;
    }
  }

  const groups: Group[] = [];
  const groupIndexOf = new Array(n).fill(-1);

  for (let i = 0; i < n; i++) {
    if (depth[i] % 2 === 0) {
      groupIndexOf[i] = groups.length;
      groups.push({ outer: contours[i], holes: [] });
    }
  }

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
    return [...ccw].reverse();
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
 * outward=true → normals point away from interior; false → into interior (cavity).
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
 * Earcut can connect collinear boundary points across gaps, producing a long edge
 * that skips vertices the walls use → a T-junction → a tiny gap. This pass splits
 * any triangle edge that has another mesh vertex lying strictly on it, until none
 * remain. Result is fully watertight regardless of earcut's triangulation.
 *
 * Used by the STL encoder. The 3D preview skips it (micro-gaps are invisible).
 */
export function repairTJunctions(tris: Tri[]): Tri[] {
  const Q = 1e5;
  const q = (x: number) => Math.round(x * Q) / Q;
  const keyOf = (p: Vec3) => `${q(p[0])},${q(p[1])},${q(p[2])}`;

  const vmap = new Map<string, number>();
  const verts: Vec3[] = [];
  const canon = (p: Vec3): number => {
    const k = keyOf(p);
    let id = vmap.get(k);
    if (id === undefined) { id = verts.length; verts.push([q(p[0]), q(p[1]), q(p[2])]); vmap.set(k, id); }
    return id;
  };
  let triIds: [number, number, number][] = tris.map((t) => [canon(t[0]), canon(t[1]), canon(t[2])]);

  const IX = verts.map((v) => [Math.round(v[0]*Q), Math.round(v[1]*Q), Math.round(v[2]*Q)]);

  const byZ = new Map<number, number[]>();
  IX.forEach((v, i) => {
    const arr = byZ.get(v[2]);
    if (arr) arr.push(i); else byZ.set(v[2], [i]);
  });

  const interiorOnEdge = (i: number, j: number): number[] => {
    const A = IX[i], B = IX[j];
    if (A[2] !== B[2]) return [];
    const abx = B[0]-A[0], aby = B[1]-A[1];
    const ab2 = abx*abx + aby*aby;
    if (ab2 === 0) return [];
    const cand = byZ.get(A[2]) ?? [];
    const hits: { vid: number; t: number }[] = [];
    for (const k of cand) {
      if (k === i || k === j) continue;
      const P = IX[k];
      const cross = abx*(P[1]-A[1]) - aby*(P[0]-A[0]);
      if (cross !== 0) continue;
      const dot = (P[0]-A[0])*abx + (P[1]-A[1])*aby;
      if (dot <= 0 || dot >= ab2) continue;
      hits.push({ vid: k, t: dot / ab2 });
    }
    hits.sort((a, b) => a.t - b.t);
    return hits.map((h) => h.vid);
  };

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
            out.push([chain[m], chain[m + 1], c]);
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

/**
 * Where the material actually starts along a scan line, by intersecting the contour
 * EDGES — not by sampling contour vertices. A straight stem (e.g. "D" in Roboto or
 * Bebas Neue) only has vertices at its corners, so vertex sampling misses its edge
 * entirely in the middle and reports some curvier letter further in.
 */
function leftmostAtY(contours: P2[][], y: number): number | null {
  let best: number | null = null;
  for (const c of contours) {
    for (let i = 0, n = c.length; i < n; i++) {
      const a = c[i], b = c[(i + 1) % n];
      if ((a.y > y) === (b.y > y)) continue; // edge doesn't straddle this y
      const x = a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
      if (best === null || x < best) best = x;
    }
  }
  return best;
}

/** Topmost material y along the vertical line at `x` (edge intersection). */
function topmostAtX(contours: P2[][], x: number): number | null {
  let best: number | null = null;
  for (const c of contours) {
    for (let i = 0, n = c.length; i < n; i++) {
      const a = c[i], b = c[(i + 1) % n];
      if ((a.x > x) === (b.x > x)) continue; // edge doesn't straddle this x
      const y = a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
      if (best === null || y > best) best = y;
    }
  }
  return best;
}

/** Axis-aligned rectangle polygon (CCW), from any two opposite corners. */
function rect(x0: number, y0: number, x1: number, y1: number): P2[] {
  const xa = Math.min(x0, x1), xb = Math.max(x0, x1);
  const ya = Math.min(y0, y1), yb = Math.max(y0, y1);
  return [{ x: xa, y: ya }, { x: xb, y: ya }, { x: xb, y: yb }, { x: xa, y: yb }];
}

/** True only if the whole disc (center + perimeter samples) lies inside poly. */
function circleInside(cx: number, cy: number, r: number, poly: P2[], samples = 24): boolean {
  if (!pointInPolygon({ x: cx, y: cy }, poly)) return false;
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * 2 * Math.PI;
    if (!pointInPolygon({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }, poly)) return false;
  }
  return true;
}

// ─── Template (heart / oval) text placement ─────────────────────────────────────

type Region = { cx: number; cy: number; halfW: number; halfH: number };

/**
 * A centered box inside a template shape where the text should live: clear of the
 * ring hole, and inset enough to stay within the curved outline.
 */
function templateTextRegion(
  shapeType: string,
  bcx: number, bcy: number, bhw: number, bhh: number,
  holeCX: number, holeCY: number,
  holePosition: "top" | "side",
  holeIsInternal: boolean,
  lineCount = 1
): Region {
  const CLR = 2.0;   // gap from the hole
  const INSET = 2.0; // gap from the shape edge
  const isHeart = shapeType === "heart";
  /**
   * A stacked block is taller and narrower than one line, and the fit scales it
   * uniformly — so with the single-line height budget the WIDTH would go to waste
   * and the letters would come out far smaller than they need to be. Give the
   * extra lines their vertical room; shrinkRegionToFit still pulls the box back
   * inside the outline, and the hole caps still apply.
   */
  const tall = lineCount > 1 ? 1.55 : 1;

  // Tab shapes (oval): the boss is sunk into the plate so it barely protrudes, which
  // puts the hole partly inside the outline. The text still sits dead centre — that
  // is the whole point of the tab — but the dimension facing the hole is capped so
  // the two never meet.
  if (!holeIsInternal) {
    const halfW = bhw * 0.66;
    const halfH = bhh * 0.50 * tall;
    if (holePosition === "side") {
      const limit = Math.max(1, Math.abs(holeCX - bcx) - HOLE_RADIUS_MM - CLR);
      return { cx: bcx, cy: bcy, halfW: Math.min(halfW, limit), halfH };
    }
    const limit = Math.max(1, Math.abs(holeCY - bcy) - HOLE_RADIUS_MM - CLR);
    return { cx: bcx, cy: bcy, halfW, halfH: Math.min(halfH, limit) };
  }

  // Round: keep the text centred on the disc and only cap the dimension facing the
  // hole, so it clears it without being pushed off-centre.
  if (shapeType === "round") {
    const r = Math.min(bhw, bhh);
    if (holePosition === "side") {
      const halfW = Math.max(1, Math.abs(holeCX - bcx) - HOLE_RADIUS_MM - CLR);
      return { cx: bcx, cy: bcy, halfW, halfH: r * 0.36 * tall };
    }
    const halfH = Math.max(1, Math.abs(holeCY - bcy) - HOLE_RADIUS_MM - CLR);
    return { cx: bcx, cy: bcy, halfW: r * 0.64, halfH: Math.min(halfH, r * 0.38 * tall) };
  }

  if (holePosition === "side") {
    const left = holeCX + HOLE_RADIUS_MM + CLR;
    const right = bcx + bhw - INSET;
    return {
      cx: (left + right) / 2,
      cy: bcy + (isHeart ? bhh * 0.08 : 0),
      halfW: Math.max(1, (right - left) / 2),
      halfH: (isHeart ? bhh * 0.34 : bhh * 0.6),
    };
  }

  // top hole
  const top = holeCY - HOLE_RADIUS_MM - CLR;
  const bottom = bcy - (isHeart ? bhh * 0.12 : bhh * 0.70);
  return {
    cx: bcx,
    cy: (top + bottom) / 2,
    halfW: bhw * (isHeart ? 0.50 : 0.72),
    halfH: Math.max(1, (top - bottom) / 2),
  };
}

/**
 * Shrink a region (keeping its center) until its whole outline lies inside the
 * body. The body is curved (ellipse / heart), so a rectangular region's corners
 * can otherwise poke outside — which makes a letter cross the outline and breaks
 * the body-top triangulation. We sample the region perimeter, not just corners,
 * so concave shapes (heart) are handled too.
 */
function shrinkRegionToFit(region: Region, body: P2[]): Region {
  let { halfW, halfH } = region;
  const { cx, cy } = region;
  const perimeterInside = (hw: number, hh: number): boolean => {
    const pts: P2[] = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * 2 * Math.PI;
      // sample the rounded box outline (ellipse through the corners is a tight,
      // conservative proxy for the rectangle's extent)
      pts.push({ x: cx + hw * Math.cos(a), y: cy + hh * Math.sin(a) });
    }
    pts.push({ x: cx + hw, y: cy + hh }, { x: cx - hw, y: cy + hh },
             { x: cx + hw, y: cy - hh }, { x: cx - hw, y: cy - hh });
    return pts.every((p) => pointInPolygon(p, body));
  };
  for (let i = 0; i < 48 && (halfW > 0.5 && halfH > 0.5); i++) {
    if (perimeterInside(halfW, halfH)) break;
    halfW *= 0.92; halfH *= 0.92;
  }
  // Small extra clearance so glyph edges never sit exactly on the wall.
  return { cx, cy, halfW: halfW * 0.96, halfH: halfH * 0.96 };
}

/** The scale the last fitContoursToRegion applied — reported as the mesh's textScale. */
let lastFitScale = 1;

/** Uniformly scale + translate contours to fill `region`, keeping them centered. */
function fitContoursToRegion(contours: P2[][], region: Region): P2[][] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of contours) for (const p of c) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const tw = maxX - minX, th = maxY - minY;
  if (!(tw > 0) || !(th > 0)) return contours;
  const scale = Math.min((2 * region.halfW) / tw, (2 * region.halfH) / th);
  lastFitScale = scale;
  const tcx = (minX + maxX) / 2, tcy = (minY + maxY) / 2;
  return contours.map((c) =>
    c.map((p) => ({ x: (p.x - tcx) * scale + region.cx, y: (p.y - tcy) * scale + region.cy }))
  );
}

// ─── Mesh builder ─────────────────────────────────────────────────────────────

/** Overall X-extent of a set of contours. */
function contoursWidth(contours: P2[][]): number {
  let minX = Infinity, maxX = -Infinity;
  for (const c of contours) for (const p of c) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
  }
  return maxX - minX;
}

/** Uniformly scale contours about their centre. */
function scaleContoursAboutCenter(contours: P2[][], s: number): P2[][] {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const c of contours) for (const p of c) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  return contours.map((c) => c.map((p) => ({ x: (p.x - cx) * s + cx, y: (p.y - cy) * s + cy })));
}

/**
 * A bridge that welds two lines of text together.
 *
 * On the "auto" shape the plate is a bubble around each glyph, so two lines are
 * joined only where a letter above happens to sit over a letter below. An unlucky
 * pair — "I" over "Alexandra" — ends up bridged by a few narrow, off-centre slivers
 * with deep notches between them: weak in 3mm PLA, and lopsided to look at.
 *
 * The bridge is sized from the SHORTER line, slightly narrower than it, and centred.
 * Both lines are centred, so that is exactly the width they are guaranteed to share
 * — wider and the bridge would poke out past the short line and flatten the
 * silhouette; this way the notches on either side survive as shape rather than as
 * weak points, because the bridge carries the load.
 *
 * `minWidthMm` is the floor. A single-character line like "I" is barely 2mm wide, and
 * 85% of that is a bridge no print would survive, so below the floor the bridge stops
 * following the line and just takes the width it needs.
 *
 * Returns null when the lines can't be told apart, in which case the caller just
 * bubbles the glyphs as before.
 */
function lineBridges(
  contours: P2[][],
  expected: number,
  minWidthMm: number
): P2[][] | null {
  if (expected <= 1 || !contours.length) return null;

  let lo = Infinity, hi = -Infinity;
  for (const c of contours) for (const p of c) {
    if (p.y < lo) lo = p.y;
    if (p.y > hi) hi = p.y;
  }
  if (!(hi > lo)) return null;

  // Which horizontal slices carry glyph material.
  const N = 400;
  const occupied = new Array<boolean>(N).fill(false);
  const rowOf = (y: number) =>
    Math.min(N - 1, Math.max(0, Math.round(((y - lo) / (hi - lo)) * (N - 1))));
  const span = (c: P2[]) => {
    let a = Infinity, b = -Infinity;
    for (const p of c) { if (p.y < a) a = p.y; if (p.y > b) b = p.y; }
    return { a, b };
  };
  for (const c of contours) {
    const { a, b } = span(c);
    for (let k = rowOf(a); k <= rowOf(b); k++) occupied[k] = true;
  }

  // Split at the WIDEST empty runs, not at every one: a ring over Å or a dot over i
  // leaves its own little gap, and treating those as line breaks would mis-count the
  // lines. The gap between lines is always the biggest.
  const empties: { a: number; b: number }[] = [];
  let run: { a: number; b: number } | null = null;
  for (let k = 0; k < N; k++) {
    if (!occupied[k]) { if (run) run.b = k; else run = { a: k, b: k }; }
    else if (run) { empties.push(run); run = null; }
  }
  if (empties.length < expected - 1) return null;

  const gaps = empties
    .sort((x, y) => (y.b - y.a) - (x.b - x.a))
    .slice(0, expected - 1)
    .sort((x, y) => x.a - y.a);

  const yOf = (k: number) => lo + (k / (N - 1)) * (hi - lo);
  /** Kept inside the shorter line so the bridge never widens the silhouette. */
  const BRIDGE_WIDTH_FACTOR = 0.85;
  /** Reach into both lines so the bridge merges with the glyphs, not just touches. */
  const BITE_MM = 0.8;

  const bridges: P2[][] = [];
  for (const gap of gaps) {
    const gLo = yOf(gap.a), gHi = yOf(gap.b);

    // Horizontal extent of the glyphs on each side of this gap.
    const extentOf = (below: boolean) => {
      let x0 = Infinity, x1 = -Infinity;
      for (const c of contours) {
        const { a, b } = span(c);
        if (below ? b > gLo : a < gHi) continue;
        for (const p of c) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; }
      }
      return x1 > x0 ? { x0, x1 } : null;
    };
    const under = extentOf(true);
    const over = extentOf(false);
    if (!under || !over) continue;

    // The width the two lines share, taken from whichever is shorter.
    const shared = Math.min(over.x1 - over.x0, under.x1 - under.x0);
    const half = Math.max(shared * BRIDGE_WIDTH_FACTOR, minWidthMm) / 2;
    const cx = (Math.max(over.x0, under.x0) + Math.min(over.x1, under.x1)) / 2;

    bridges.push(rect(cx - half, gLo - BITE_MM, cx + half, gHi + BITE_MM));
  }
  return bridges.length ? bridges : null;
}

/**
 * Plate margin around the lettering. Tied to the letter size (not the plate, which has
 * no fixed size any more) so every size keeps the same visual proportions.
 */
function autoMargin(size: KeyringSizeOption, text = "", textScale = 1): number {
  // Follows the ACHIEVED letter size, not the nominal one. When the lettering is
  // scaled to land on the size's target area, a fixed margin would leave a long name
  // with a fat border and a short one with a thin one — and it would stop the plate
  // being self-similar, which is what makes the area land in one correction.
  return lineCapHeight(text, size) * 0.32 * textScale;
}

/**
 * Build the keyring mesh from raw text contours, split into base + text groups.
 * Triangles are NOT T-junction-repaired here; the STL path repairs the combined
 * list, the preview path renders the groups as-is.
 */
/**
 * One pass of the geometry.
 *
 * `plateScale` stretches a template's plate, `textScale` the lettering — the two
 * knobs buildKeyringMesh turns to land the footprint on the size's target area.
 */
function buildMeshOnce(
  rawContours: P2[][],
  config: KeyringConfig,
  size: KeyringSizeOption,
  plateScale = 1,
  textScale = 1
): KeyringMesh {
  if (textScale !== 1) rawContours = scaleContoursAboutCenter(rawContours, textScale);
  lastFitScale = 1; // "auto" never refits; templates overwrite this below
  // A round tag only ever gets a top hole; pin it here too so an older order or a
  // hand-built config can't produce a side-drilled disc.
  const holePosition = config.shapeType === "round" ? "top" : (config.holePosition ?? "top");

  // "auto" = consistent LETTER size: the text arrives already scaled to the size's
  // advertised cap height and is never rescaled, so the lettering is exactly the
  // advertised size for every name. The plate simply grows around it — a short name
  // gives a short keyring, a long one a long keyring — and the character limit
  // (MAX_TEXT_LENGTH) is what bounds the overall length.

  // Determine the body outline, ring-hole position, and the (possibly re-fitted)
  // text contours. AUTO wraps a bubble around the text; templates (heart/oval)
  // use a fixed body and fit the text into a region that clears the hole.
  let body: P2[];
  let holeCX = 0, holeCY = 0;
  let textContours: P2[][] = rawContours;

  if (config.shapeType === "auto") {
    const groups = groupByDepth(cleanUnion(rawContours));
    // Keep the glyph-hugging silhouette, but weld the lines together across the gap
    // so the join can never come out as a few thin, off-centre slivers.
    // The margin fattens the bridge on both sides, so ask the bridge itself only for
    // what the bubble won't already provide.
    const bridges = lineBridges(
      rawContours,
      splitTextLines(config.text).length,
      Math.max(0, MIN_LINE_BRIDGE_MM - 2 * autoMargin(size, config.text, textScale))
    ) ?? [];
    const outlines = [...groups.map((g) => g.outer), ...bridges];

    if (groups.length) {
      const allPts = outlines.flat();
      const minX = Math.min(...allPts.map((p) => p.x));
      const maxX = Math.max(...allPts.map((p) => p.x));
      const minY = Math.min(...allPts.map((p) => p.y));
      const maxY = Math.max(...allPts.map((p) => p.y));
      const marginMm = autoMargin(size, config.text, textScale);
      const neckHalf = TAB_RADIUS_MM * 0.65;

      // The hole always sits clear of ALL text (left of / above everything), and a neck
      // welds it to the material on the scan line nearest the centre that actually has
      // material — so it's centred, never lands inside the lettering, and stays solidly
      // connected whatever the font's letter heights.
      const outers = outlines;
      const OVERLAP = 3; // how far the neck reaches into the material
      const SAMPLES = 64;
      let neck: P2[];
      if (holePosition === "side") {
        // Scan heights for the one nearest the vertical centre that has material.
        const cY = (minY + maxY) / 2;
        let bestY = cY, bestLeft = minX, bestDist = Infinity;
        for (let i = 0; i <= SAMPLES; i++) {
          const y = minY + ((maxY - minY) * i) / SAMPLES;
          const lx = leftmostAtY(outers, y);
          if (lx === null) continue;
          const d = Math.abs(y - cY);
          if (d < bestDist) { bestDist = d; bestY = y; bestLeft = lx; }
        }
        holeCY = bestY;
        holeCX = minX - TAB_CLEARANCE_MM - TAB_RADIUS_MM; // clear of all text
        neck = rect(holeCX, holeCY - neckHalf, bestLeft + OVERLAP, holeCY + neckHalf);
      } else {
        // Scan columns for the one nearest the horizontal centre that has material.
        const cX = (minX + maxX) / 2;
        let bestX = cX, bestTop = maxY, bestDist = Infinity;
        for (let i = 0; i <= SAMPLES; i++) {
          const x = minX + ((maxX - minX) * i) / SAMPLES;
          const ty = topmostAtX(outers, x);
          if (ty === null) continue;
          const d = Math.abs(x - cX);
          if (d < bestDist) { bestDist = d; bestX = x; bestTop = ty; }
        }
        holeCX = bestX;
        holeCY = maxY + TAB_CLEARANCE_MM + TAB_RADIUS_MM; // clear above all text
        neck = rect(holeCX - neckHalf, holeCY, holeCX + neckHalf, bestTop - OVERLAP);
      }
      const tab = circle(holeCX, holeCY, TAB_RADIUS_MM);
      body = bubbleAround([...outlines, tab, neck], marginMm)
        ?? getShapePolygon("auto", size.widthMm, size.heightMm);
    } else {
      body = getShapePolygon("auto", size.widthMm, size.heightMm);
      holeCX = 0;
      holeCY = Math.max(...body.map((p) => p.y)) - HOLE_RADIUS_MM - 2.5;
    }
  } else {
    // Template: fixed body at the advertised size — grown taller when the text has
    // two lines, so the extra row costs plate rather than letter height.
    const plateSize = plateSizeFor(size, splitTextLines(config.text).length);
    const plate = getShapePolygon(
      config.shapeType,
      plateSize.widthMm * plateScale,
      plateSize.heightMm * plateScale
    );
    const xs = plate.map((p) => p.x), ys = plate.map((p) => p.y);
    const bMinX = Math.min(...xs), bMaxX = Math.max(...xs);
    const bMinY = Math.min(...ys), bMaxY = Math.max(...ys);
    const bcx = (bMinX + bMaxX) / 2, bcy = (bMinY + bMaxY) / 2;
    const bhw = (bMaxX - bMinX) / 2, bhh = (bMaxY - bMinY) / 2;
    const usesTab = templateUsesTab(config.shapeType);

    if (usesTab) {
      // Hang the ring hole off an external tab, exactly like the "auto" shape. That
      // frees the whole plate for the lettering, which is what lets the text sit
      // properly centred instead of being pushed aside by an inset hole.
      //
      // The plate is grown back to size by the same blend it is shrunk by, so the
      // union's round joins fillet the tab joint without inflating the tag: erode
      // then dilate returns a convex shape unchanged.
      const blend = OVAL_TAB_BLEND_MM;
      const tabR = OVAL_TAB_RADIUS_MM;
      const core = getShapePolygon(
        config.shapeType, (bhw - blend) * 2, (bhh - blend) * 2
      ).map((p) => ({ x: p.x + bcx, y: p.y + bcy }));

      // Sink the boss into the plate until only OVAL_TAB_PROTRUSION_MM of it shows.
      // Because it overlaps the outline it also needs no neck to hang off — most of
      // the material around the hole simply IS the plate.
      if (holePosition === "side") {
        holeCX = bMinX - OVAL_TAB_PROTRUSION_MM + tabR;
        holeCY = bcy;
      } else {
        holeCX = bcx;
        holeCY = bMaxY + OVAL_TAB_PROTRUSION_MM - tabR;
      }
      const tab = circle(holeCX, holeCY, tabR - blend);
      body = bubbleAround([core, tab], blend) ?? plate;
    } else {
      // Hole punched through the plate itself: slide it inward from the edge until
      // it sits fully inside, leaving a wall around it.
      body = plate;
      const slack = 0.6;
      if (holePosition === "side") {
        holeCX = bMinX + HOLE_RADIUS_MM + 2.6; holeCY = bcy;
        for (let g = 0; g < 80 && !circleInside(holeCX, holeCY, HOLE_RADIUS_MM + slack, body); g++) holeCX += 0.5;
      } else {
        holeCX = bcx; holeCY = bMaxY - HOLE_RADIUS_MM - 2.6;
        for (let g = 0; g < 80 && !circleInside(holeCX, holeCY, HOLE_RADIUS_MM + slack, body); g++) holeCY -= 0.5;
      }
    }

    const region = shrinkRegionToFit(
      templateTextRegion(
        config.shapeType, bcx, bcy, bhw, bhh, holeCX, holeCY, holePosition, !usesTab,
        splitTextLines(config.text).length
      ),
      body
    );
    textContours = fitContoursToRegion(rawContours, region);
  }

  const ringHole = circle(holeCX, holeCY, HOLE_RADIUS_MM);

  // Group the (possibly re-fitted) text and keep only letters inside the body.
  const groups = groupByDepth(cleanUnion(textContours));
  const inkGroups = groups.filter((g) => pointInPolygon(samplePoint(g.outer), body));
  const inkOuters = inkGroups.map((g) => g.outer);
  const inkHoles  = inkGroups.flatMap((g) => g.holes);

  const base: Tri[] = [];
  const text: Tri[] = [];

  // BASE — body bottom, outer wall, ring-hole wall, body top surface.
  base.push(...faceTriangles(body, [ringHole], 0, false));
  base.push(...wall(body, 0, BASE_HEIGHT_MM, true));
  base.push(...wall(ringHole, 0, BASE_HEIGHT_MM, false));
  base.push(...faceTriangles(body, [ringHole, ...inkOuters], BASE_HEIGHT_MM, true));
  for (const counter of inkHoles) {
    base.push(...faceTriangles(counter, [], BASE_HEIGHT_MM, true));
  }

  // TEXT — letter walls and letter tops.
  for (const outer of inkOuters) {
    text.push(...wall(outer, BASE_HEIGHT_MM, TOTAL_HEIGHT_MM, true));
  }
  for (const counter of inkHoles) {
    text.push(...wall(counter, BASE_HEIGHT_MM, TOTAL_HEIGHT_MM, false));
  }
  for (const g of inkGroups) {
    text.push(...faceTriangles(g.outer, g.holes, TOTAL_HEIGHT_MM, true));
  }

  // No post-scaling: the lettering is already at its advertised size, and leaving the
  // mesh alone keeps the ring hole at its true 5mm diameter for every name.
  // Sum the bottom face: one flat, closed layer, so it is the footprint exactly —
  // holes included as holes, tab and all.
  let areaMm2 = 0;
  for (const [a, b, c] of base) {
    if (Math.min(a[2], b[2], c[2]) > 0.01) continue; // top/side triangles
    areaMm2 += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  }

  return {
    base, text,
    hole: { cx: holeCX, cy: holeCY, r: HOLE_RADIUS_MM },
    areaMm2,
    textScale: textScale * lastFitScale,
  };
}

/**
 * Build the keyring, sized so its plate covers the area its size is sold as.
 *
 * The size a customer picks is a fixed price, so it has to be a fixed amount of
 * keyring — otherwise "Lille" is a 4cm² tag for "Bo" and an 11cm² one for
 * "Alexandra" at the same money, and a round tag is worth less than an oval. What
 * the size actually buys is `areaCm2`; the lettering and the plate are scaled to
 * land on it.
 *
 * Which knob moves depends on the shape. A template's plate is its own shape, so
 * the plate is stretched and the text follows it into the region. "auto" has no
 * plate of its own — it is a bubble around the letters — so the letters are scaled
 * and the plate follows them.
 *
 * Area goes as the square of either knob, so a single correction would be exact if
 * the ring hole scaled too. It doesn't (a split ring needs 5mm whatever the tag),
 * so it takes a couple of passes to settle.
 */
export function buildKeyringMesh(
  rawContours: P2[][],
  config: KeyringConfig,
  size: KeyringSizeOption
): KeyringMesh {
  const target = (size.areaCm2 ?? 0) * 100; // cm² → mm²
  let mesh = buildMeshOnce(rawContours, config, size);
  if (!(target > 0) || !(mesh.areaMm2 > 0)) return mesh;

  const isAuto = config.shapeType === "auto";
  let scale = 1;
  for (let pass = 0; pass < 8; pass++) {
    const correction = Math.sqrt(target / mesh.areaMm2);
    if (Math.abs(correction - 1) < 0.005) break;
    // The plate is self-similar under this scale, so area goes as its square and the
    // correction is nearly exact; the passes are for the ring hole, which keeps its
    // 5mm whatever the tag and so refuses to scale with everything else.
    scale *= correction;
    const next = isAuto
      ? buildMeshOnce(rawContours, config, size, 1, scale)
      : buildMeshOnce(rawContours, config, size, scale, 1);
    if (!(next.areaMm2 > 0)) break;
    mesh = next;
  }
  return mesh;
}
