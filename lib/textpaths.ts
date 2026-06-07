/**
 * Text path extraction from opentype.js font data.
 *
 * Produces clean 2D contours (mm units, Y-up) suitable for clipper + earcut:
 *  - Bézier curves flattened with an adaptive chord tolerance
 *  - NO duplicate closing point (clipper/earcut auto-close)
 *  - consecutive duplicate points removed (avoids degenerate triangles)
 */

export type Point = { x: number; y: number };

interface PathCommand {
  type: string;
  x?: number; y?: number;
  x1?: number; y1?: number;
  x2?: number; y2?: number;
}

const CHORD_TOL_MM = 0.12; // max deviation between curve and its polyline
const DEDUP_EPS    = 1e-4; // points closer than this (mm) are merged

function cubicBezier(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const mt = 1 - t;
  return mt ** 3 * p0 + 3 * mt ** 2 * t * p1 + 3 * mt * t ** 2 * p2 + t ** 3 * p3;
}

function quadBezier(t: number, p0: number, p1: number, p2: number): number {
  const mt = 1 - t;
  return mt ** 2 * p0 + 2 * mt * t * p1 + t ** 2 * p2;
}

/** Estimate subdivision count from control-polygon length and chord tolerance. */
function curveSteps(...pts: Point[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) {
    len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return Math.min(96, Math.max(4, Math.ceil(len / CHORD_TOL_MM)));
}

/** Append a point unless it duplicates the previous one. */
function pushPt(arr: Point[], x: number, y: number): void {
  const last = arr[arr.length - 1];
  if (last && Math.abs(last.x - x) < DEDUP_EPS && Math.abs(last.y - y) < DEDUP_EPS) return;
  arr.push({ x, y });
}

/** Drop a trailing point that duplicates the first (open the ring for clipper/earcut). */
function finishContour(c: Point[]): Point[] {
  if (c.length >= 2) {
    const first = c[0];
    const last = c[c.length - 1];
    if (Math.abs(first.x - last.x) < DEDUP_EPS && Math.abs(first.y - last.y) < DEDUP_EPS) {
      c.pop();
    }
  }
  return c;
}

/**
 * Convert opentype path commands → array of contour polylines.
 * Y is flipped (opentype uses screen-down convention, we want math-up).
 * Coordinates are in mm (font is loaded with fontSize = desired mm size).
 */
export function commandsToContours(commands: PathCommand[]): Point[][] {
  const contours: Point[][] = [];
  let current: Point[] = [];
  let cx = 0, cy = 0; // current pen position in opentype (un-flipped) coords

  const flush = () => {
    const c = finishContour(current);
    if (c.length >= 3) contours.push(c);
    current = [];
  };

  for (const cmd of commands) {
    if (cmd.type === "M") {
      flush();
      current = [];
      pushPt(current, cmd.x!, -cmd.y!);
      cx = cmd.x!; cy = cmd.y!;
    } else if (cmd.type === "L") {
      pushPt(current, cmd.x!, -cmd.y!);
      cx = cmd.x!; cy = cmd.y!;
    } else if (cmd.type === "C") {
      const steps = curveSteps(
        { x: cx, y: cy },
        { x: cmd.x1!, y: cmd.y1! },
        { x: cmd.x2!, y: cmd.y2! },
        { x: cmd.x!, y: cmd.y! }
      );
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        pushPt(
          current,
          cubicBezier(t, cx, cmd.x1!, cmd.x2!, cmd.x!),
          -cubicBezier(t, cy, cmd.y1!, cmd.y2!, cmd.y!)
        );
      }
      cx = cmd.x!; cy = cmd.y!;
    } else if (cmd.type === "Q") {
      const steps = curveSteps(
        { x: cx, y: cy },
        { x: cmd.x1!, y: cmd.y1! },
        { x: cmd.x!, y: cmd.y! }
      );
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        pushPt(
          current,
          quadBezier(t, cx, cmd.x1!, cmd.x!),
          -quadBezier(t, cy, cmd.y1!, cmd.y!)
        );
      }
      cx = cmd.x!; cy = cmd.y!;
    } else if (cmd.type === "Z") {
      flush();
    }
  }
  flush();
  return contours;
}

/**
 * Minimal structural type for the parts of an opentype.js Font we use.
 * Avoids a hard type dependency on opentype.js (which is loaded differently
 * on server vs. client).
 */
export interface OpenTypeFontLike {
  getAdvanceWidth(text: string, fontSize: number): number;
  getPath(text: string, x: number, y: number, fontSize: number): { commands: PathCommand[] };
}

/**
 * Extract centered text contours from an ALREADY-PARSED opentype font.
 * Pure (no fs / no fetch) → runs identically on server and in the browser.
 * fontSize = desired cap height in mm. Returns contours in mm, centered at (0,0).
 */
export function contoursFromFont(
  font: OpenTypeFontLike,
  text: string,
  fontSize: number
): Point[][] {
  const textWidth = font.getAdvanceWidth(text, fontSize);
  const startX = -textWidth / 2;
  const textPath = font.getPath(text, startX, 0, fontSize);
  const contours = commandsToContours(textPath.commands);

  // Vertically center on the glyph bounding box (baseline-independent)
  if (contours.length) {
    let minY = Infinity, maxY = -Infinity;
    for (const c of contours) for (const p of c) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const cy = (minY + maxY) / 2;
    for (const c of contours) for (const p of c) p.y -= cy;
  }

  return contours;
}
