/**
 * Text-following shape computation using clipper-lib.
 * Takes the actual text contours and expands them outward uniformly,
 * producing a smooth "bubble" shape that follows the text outline.
 */

import type { Point } from "./textpaths";

const SCALE = 1000; // mm → clipper integer coordinates

/**
 * Compute the keyring outline shape by:
 * 1. Taking the union of all text character contours
 * 2. Expanding outward by marginMm with round joins
 *
 * Returns a single polygon in mm coords centered around origin.
 * Falls back to a rounded rectangle if clipper returns empty result.
 */
export function computeTextShape(
  contours: Point[][],
  marginMm: number,
  fallbackWidthMm: number,
  fallbackHeightMm: number
): Point[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ClipperLib = require("clipper-lib");

  if (!contours.length) return roundedRect(fallbackWidthMm, fallbackHeightMm);

  // Convert to clipper integer paths (filter out degenerate contours)
  const clipPaths = contours
    .filter((c) => c.length >= 3)
    .map((c) =>
      c.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }))
    );

  if (!clipPaths.length) return roundedRect(fallbackWidthMm, fallbackHeightMm);

  // Step 1: offset each path individually (avoids self-intersection issues)
  // Then union the results. This is more robust than unioning raw font outlines
  // (which can have opposite winding for counter-shapes like the hole in 'O').
  const co = new ClipperLib.ClipperOffset(2, 0.25);
  co.AddPaths(clipPaths, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const offsetResult: { X: number; Y: number }[][] = [];
  co.Execute(offsetResult, marginMm * SCALE);

  if (!offsetResult.length) return roundedRect(fallbackWidthMm, fallbackHeightMm);

  // Union all offset polygons (they may overlap for adjacent letters)
  const clipper = new ClipperLib.Clipper();
  clipper.AddPaths(offsetResult, ClipperLib.PolyType.ptSubject, true);
  const unionResult: { X: number; Y: number }[][] = [];
  clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    unionResult,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero
  );

  if (!unionResult.length) return roundedRect(fallbackWidthMm, fallbackHeightMm);

  // Take the largest polygon (outer shell, ignoring any inner holes from 'O', 'P' etc.)
  const largest = unionResult.reduce((a, b) => (a.length >= b.length ? a : b));

  // Convert back to mm
  const result = largest.map((p) => ({ x: p.X / SCALE, y: p.Y / SCALE }));

  // Sanity check: if result is tiny, fall back
  const xs = result.map((p) => p.x);
  const ys = result.map((p) => p.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  if (w < 5 || h < 3) return roundedRect(fallbackWidthMm, fallbackHeightMm);

  return result;
}

/**
 * Compute a circle polygon for the keyring hole.
 * Positioned at the top-center of the shape.
 */
export function holePolygon(cx: number, cy: number, r = 4, steps = 48): Point[] {
  return Array.from({ length: steps }, (_, i) => {
    const t = (i / steps) * 2 * Math.PI;
    return { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) };
  });
}

/**
 * Find the topmost Y of a polygon and return the hole center position.
 * The hole sits 2mm + holeRadius below the topmost point.
 */
export function findHoleCenter(
  shape: Point[],
  holeRadius = 4
): { cx: number; cy: number } {
  const cx = shape.reduce((s, p) => s + p.x, 0) / shape.length;
  const topY = Math.max(...shape.map((p) => p.y));
  const cy = topY - holeRadius - 1.5;
  return { cx, cy };
}

/** Fallback: simple rounded rectangle centered at origin */
function roundedRect(widthMm: number, heightMm: number, steps = 64): Point[] {
  const hw = widthMm / 2;
  const hh = heightMm / 2;
  const r = Math.min(hw, hh) * 0.25;
  const pts: Point[] = [];
  const corners = [
    { cx: hw - r,  cy: -hh + r, start: -Math.PI / 2, end: 0 },
    { cx: hw - r,  cy:  hh - r, start: 0, end: Math.PI / 2 },
    { cx: -hw + r, cy:  hh - r, start: Math.PI / 2, end: Math.PI },
    { cx: -hw + r, cy: -hh + r, start: Math.PI, end: (3 * Math.PI) / 2 },
  ];
  const cs = Math.floor(steps / 4);
  for (const { cx, cy, start, end } of corners) {
    for (let i = 0; i <= cs; i++) {
      const t = start + (i / cs) * (end - start);
      pts.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) });
    }
  }
  return pts;
}
