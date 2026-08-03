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
import { getShapePolygon } from "./keyring";
import type { Point } from "./textpaths";

const earcut: (data: number[], holes?: number[], dim?: number) => number[] =
  // earcut ships as CJS; the default export is the function.
  (earcutMod as unknown as { default?: typeof earcutMod }).default ?? earcutMod;

// ─── Print geometry constants ─────────────────────────────────────────────────

export const BASE_HEIGHT_MM   = 2.4;  // keyring body height
export const TEXT_HEIGHT_MM    = 0.8;  // raised text above body
export const TOTAL_HEIGHT_MM   = BASE_HEIGHT_MM + TEXT_HEIGHT_MM;
const HOLE_RADIUS_MM    = 2.5;  // ring attachment hole radius
const TAB_RADIUS_MM     = HOLE_RADIUS_MM + 1.8; // solid nub around the hole (wall ≈1.8mm)
const TAB_CLEARANCE_MM  = 1.0;  // gap between tallest letter and tab circle

const SCALE = 1000; // mm → clipper integer coordinates

// ─── Mesh types ───────────────────────────────────────────────────────────────

export type Vec3 = [number, number, number];
export type Tri  = [Vec3, Vec3, Vec3];
export type KeyringMesh = { base: Tri[]; text: Tri[] };
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
 * Offset (expand) a set of contours outward by deltaMm with round joins,
 * then return the unioned outer boundary (single polygon). The "bubble".
 */
function bubbleAround(contours: P2[][], deltaMm: number): P2[] | null {
  const paths = contours.filter((c) => c.length >= 3).map(toClipper);
  if (!paths.length) return null;

  const co = new ClipperLib.ClipperOffset(2.0, SCALE * 0.05);
  co.AddPaths(paths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const offset: IPt[][] = [];
  co.Execute(offset, deltaMm * SCALE);
  if (!offset.length) return null;

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
  const largest = mm.reduce((a, b) =>
    Math.abs(signedArea(a)) >= Math.abs(signedArea(b)) ? a : b
  );
  return largest;
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
  holePosition: "top" | "side"
): Region {
  const CLR = 2.0;   // gap from the hole
  const INSET = 2.0; // gap from the shape edge
  const isHeart = shapeType === "heart";

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
 * Uniformly scale a mesh in X/Y (keeping Z = print height) about its centre so its
 * overall width becomes `targetWidth`. Used for "auto" keyrings so every name comes
 * out at the advertised width regardless of length (height follows the aspect ratio).
 */
function scaleMeshToWidth(mesh: KeyringMesh, targetWidth: number): KeyringMesh {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const grp of [mesh.base, mesh.text]) for (const t of grp) for (const v of t) {
    if (v[0] < minX) minX = v[0];
    if (v[0] > maxX) maxX = v[0];
    if (v[1] < minY) minY = v[1];
    if (v[1] > maxY) maxY = v[1];
  }
  const w = maxX - minX;
  if (!(w > 0)) return mesh;
  const s = targetWidth / w;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const scaleTri = (t: Tri): Tri =>
    t.map((v) => [(v[0] - cx) * s + cx, (v[1] - cy) * s + cy, v[2]]) as Tri;
  return { base: mesh.base.map(scaleTri), text: mesh.text.map(scaleTri) };
}

/**
 * Build the keyring mesh from raw text contours, split into base + text groups.
 * Triangles are NOT T-junction-repaired here; the STL path repairs the combined
 * list, the preview path renders the groups as-is.
 */
export function buildKeyringMesh(
  rawContours: P2[][],
  config: KeyringConfig,
  size: KeyringSizeOption
): KeyringMesh {
  const holePosition = config.holePosition ?? "top";

  // "auto" = consistent width: size the text to fill the advertised width up front,
  // so the fixed hole-tab stays proportional and the ring doesn't come out oddly tall
  // for short names. (The incoming fontSize is height-capped, which would otherwise
  // make short names' text too small relative to the tab.) A final width-normalisation
  // at the end makes the overall footprint exactly the advertised width.
  if (config.shapeType === "auto") {
    const marginMm = Math.min(size.widthMm, size.heightMm) * 0.16;
    const targetTextWidth = Math.max(5, size.widthMm - 2 * marginMm);
    const cw = contoursWidth(rawContours);
    if (cw > 0) rawContours = scaleContoursAboutCenter(rawContours, targetTextWidth / cw);
  }

  // Determine the body outline, ring-hole position, and the (possibly re-fitted)
  // text contours. AUTO wraps a bubble around the text; templates (heart/oval)
  // use a fixed body and fit the text into a region that clears the hole.
  let body: P2[];
  let holeCX = 0, holeCY = 0;
  let textContours: P2[][] = rawContours;

  if (config.shapeType === "auto") {
    const groups = groupByDepth(cleanUnion(rawContours));
    if (groups.length) {
      const allPts = groups.flatMap((g) => g.outer);
      const minX = Math.min(...allPts.map((p) => p.x));
      const maxX = Math.max(...allPts.map((p) => p.x));
      const minY = Math.min(...allPts.map((p) => p.y));
      const maxY = Math.max(...allPts.map((p) => p.y));
      const marginMm = Math.min(size.widthMm, size.heightMm) * 0.16;
      const neckHalf = TAB_RADIUS_MM * 0.65;

      // Place the hole over the SOLID part of the text nearest the centre (never over a
      // gap between letters, whatever the font), and weld it on with a short neck — so
      // the tab is always solidly connected to the plate. `ridge` = the boundary points
      // that reach the top (top hole) / left (side hole) edge.
      let neck: P2[];
      if (holePosition === "side") {
        const cY = (minY + maxY) / 2;
        const ridge = allPts.filter((p) => p.x <= minX + 1.5);
        holeCY = ridge.reduce((b, p) => (Math.abs(p.y - cY) < Math.abs(b - cY) ? p.y : b), ridge[0]?.y ?? cY);
        holeCX = minX - TAB_CLEARANCE_MM - TAB_RADIUS_MM;
        neck = rect(holeCX, holeCY - neckHalf, minX + 2, holeCY + neckHalf);
      } else {
        const cX = (minX + maxX) / 2;
        const ridge = allPts.filter((p) => p.y >= maxY - 1.5);
        holeCX = ridge.reduce((b, p) => (Math.abs(p.x - cX) < Math.abs(b - cX) ? p.x : b), ridge[0]?.x ?? cX);
        holeCY = maxY + TAB_CLEARANCE_MM + TAB_RADIUS_MM;
        neck = rect(holeCX - neckHalf, holeCY, holeCX + neckHalf, maxY - 2);
      }
      const tab = circle(holeCX, holeCY, TAB_RADIUS_MM);
      body = bubbleAround([...groups.map((g) => g.outer), tab, neck], marginMm)
        ?? getShapePolygon("auto", size.widthMm, size.heightMm);
    } else {
      body = getShapePolygon("auto", size.widthMm, size.heightMm);
      holeCX = 0;
      holeCY = Math.max(...body.map((p) => p.y)) - HOLE_RADIUS_MM - 2.5;
    }
  } else {
    // Template: fixed body. Place the hole fully inside (slide inward from the
    // edge), then fit the text into a region that avoids it.
    body = getShapePolygon(config.shapeType, size.widthMm, size.heightMm);
    const xs = body.map((p) => p.x), ys = body.map((p) => p.y);
    const bMinX = Math.min(...xs), bMaxX = Math.max(...xs);
    const bMinY = Math.min(...ys), bMaxY = Math.max(...ys);
    const bcx = (bMinX + bMaxX) / 2, bcy = (bMinY + bMaxY) / 2;
    const bhw = (bMaxX - bMinX) / 2, bhh = (bMaxY - bMinY) / 2;
    const slack = 0.6; // keep a little wall around the hole

    if (holePosition === "side") {
      holeCX = bMinX + HOLE_RADIUS_MM + 1.5; holeCY = bcy;
      for (let g = 0; g < 80 && !circleInside(holeCX, holeCY, HOLE_RADIUS_MM + slack, body); g++) holeCX += 0.5;
    } else {
      holeCX = bcx; holeCY = bMaxY - HOLE_RADIUS_MM - 1.5;
      for (let g = 0; g < 80 && !circleInside(holeCX, holeCY, HOLE_RADIUS_MM + slack, body); g++) holeCY -= 0.5;
    }

    const region = shrinkRegionToFit(
      templateTextRegion(config.shapeType, bcx, bcy, bhw, bhh, holeCX, holeCY, holePosition),
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

  const mesh = { base, text };
  // "auto" keyrings wrap tightly around the text, so their footprint depends on the
  // name length. Normalise to the advertised width so every name comes out at a
  // consistent, predictable width (templates already use fixed advertised dimensions).
  return config.shapeType === "auto" ? scaleMeshToWidth(mesh, size.widthMm) : mesh;
}
