/**
 * G-code generator for printOKAY keyring configurator.
 * Generates FDM G-code for Bambu Lab X1 Carbon (compatible with standard Marlin).
 *
 * Strategy (2.5D embossed text):
 *  Layers 1–12 (0–2.4mm) : Keyring shape in base color (perimeter + infill)
 *  M600                   : Filament change to text color
 *  Layers 13–15 (2.4–3.0mm): Text letters in text color (perimeter + infill)
 */

import fs from "fs";
import path from "path";

// ─── Print parameters ─────────────────────────────────────────────────────────

const LAYER_HEIGHT  = 0.2;   // mm
const LINE_WIDTH    = 0.45;  // mm
const FILAMENT_DIAM = 1.75;  // mm
const PRINT_SPEED   = 2400;  // mm/min (40 mm/s)
const TRAVEL_SPEED  = 9000;  // mm/min
const PERIMETER_PASSES = 2;  // number of concentric walls
const INFILL_DENSITY   = 0.4;
const INFILL_SPACING   = LINE_WIDTH / INFILL_DENSITY; // ~1.125 mm

const BASE_HEIGHT_MM   = 2.4; // total body height
const TEXT_HEIGHT_MM   = 0.6; // raised text above body
const BASE_LAYERS      = Math.round(BASE_HEIGHT_MM / LAYER_HEIGHT);  // 12
const TEXT_LAYERS      = Math.round(TEXT_HEIGHT_MM / LAYER_HEIGHT);  // 3
const TOTAL_LAYERS     = BASE_LAYERS + TEXT_LAYERS;
const TOTAL_HEIGHT     = BASE_HEIGHT_MM + TEXT_HEIGHT_MM;            // 3.0mm

const HOLE_RADIUS      = 4;   // mm (Ø8mm keyring hole)

// Filament extrusion volume per mm of travel
const E_PER_MM = (LINE_WIDTH * LAYER_HEIGHT) / (Math.PI * (FILAMENT_DIAM / 2) ** 2);

// Print bed center (X1 Carbon is 256×256mm)
const BED_CENTER_X = 128;
const BED_CENTER_Y = 128;

// ─── Types ────────────────────────────────────────────────────────────────────

type Point = { x: number; y: number };

// ─── State ────────────────────────────────────────────────────────────────────

let currentX = 0;
let currentY = 0;
let currentE = 0;
let currentZ = 0;
const lines: string[] = [];

function emit(line: string) { lines.push(line); }

function moveTo(x: number, y: number) {
  emit(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} F${TRAVEL_SPEED}`);
  currentX = x;
  currentY = y;
}

function extrudeTo(x: number, y: number) {
  const dx = x - currentX;
  const dy = y - currentY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.01) return;
  currentE += dist * E_PER_MM;
  emit(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} E${currentE.toFixed(4)} F${PRINT_SPEED}`);
  currentX = x;
  currentY = y;
}

function liftAndMove(x: number, y: number, zCurrent: number) {
  emit(`G1 Z${(zCurrent + 0.4).toFixed(2)} F600`); // lift 0.4mm
  emit(`G1 X${x.toFixed(3)} Y${y.toFixed(3)} F${TRAVEL_SPEED}`);
  emit(`G1 Z${zCurrent.toFixed(2)} F600`);
  currentX = x;
  currentY = y;
}

function setLayer(layerNum: number) {
  const z = layerNum * LAYER_HEIGHT;
  currentZ = z;
  emit(`; Layer ${layerNum} Z=${z.toFixed(2)}`);
  emit(`G1 Z${z.toFixed(2)} F600`);
}

// ─── Geometry helpers ─────────────────────────────────────────────────────────

function dist(a: Point, b: Point) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}

function pointInPolygon(x: number, y: number, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function inHole(x: number, y: number, holeCx: number, holeCy: number): boolean {
  return (x - holeCx) ** 2 + (y - holeCy) ** 2 < HOLE_RADIUS ** 2;
}

/**
 * Offset polygon inward (positive delta = shrink).
 * Simplified: shrink each point toward centroid.
 */
function offsetPolygon(poly: Point[], delta: number): Point[] {
  const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length;
  const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length;
  return poly.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    return {
      x: p.x - (dx / len) * delta,
      y: p.y - (dy / len) * delta,
    };
  });
}

/** Generate scanline infill intersections for a polygon at spacing `spacing`. */
function scanlineInfill(
  poly: Point[],
  offsetX: number,
  offsetY: number,
  excludeHole?: { cx: number; cy: number }
): [Point, Point][] {
  // Translate polygon to global coords
  const gpoly = poly.map((p) => ({ x: p.x + offsetX, y: p.y + offsetY }));

  const ys = gpoly.map((p) => p.y);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const segments: [Point, Point][] = [];
  let flip = false;

  for (let y = minY + INFILL_SPACING / 2; y <= maxY; y += INFILL_SPACING) {
    // Find x intersections at this y
    const xs: number[] = [];
    for (let i = 0, j = gpoly.length - 1; i < gpoly.length; j = i++) {
      const yi = gpoly[i].y, yj = gpoly[j].y;
      if ((yi <= y && y < yj) || (yj <= y && y < yi)) {
        const t = (y - yi) / (yj - yi);
        xs.push(gpoly[i].x + t * (gpoly[j].x - gpoly[i].x));
      }
    }
    xs.sort((a, b) => a - b);

    for (let k = 0; k + 1 < xs.length; k += 2) {
      let x0 = xs[k] + LINE_WIDTH / 2;
      let x1 = xs[k + 1] - LINE_WIDTH / 2;
      if (x0 >= x1) continue;

      // Split segment at hole boundary if needed
      if (excludeHole) {
        const { cx, cy } = excludeHole;
        const dy = y - cy;
        if (Math.abs(dy) < HOLE_RADIUS) {
          const hx = Math.sqrt(HOLE_RADIUS ** 2 - dy * dy);
          const hLeft = cx - hx;
          const hRight = cx + hx;
          // Emit segment before hole
          if (x0 < hLeft && hLeft < x1) {
            segments.push(flip ? [{ x: Math.min(hLeft - LINE_WIDTH/2, x1), y }, { x: x0, y }]
                                : [{ x: x0, y }, { x: Math.min(hLeft - LINE_WIDTH/2, x1), y }]);
            flip = !flip;
            x0 = Math.max(hRight + LINE_WIDTH/2, x0);
          }
        }
      }

      if (x0 < x1) {
        segments.push(flip ? [{ x: x1, y }, { x: x0, y }] : [{ x: x0, y }, { x: x1, y }]);
        flip = !flip;
      }
    }
  }
  return segments;
}

// ─── Print operations ──────────────────────────────────────────────────────────

function printPolygon(poly: Point[], offsetX: number, offsetY: number, z: number) {
  if (poly.length < 2) return;
  const start = { x: poly[0].x + offsetX, y: poly[0].y + offsetY };
  liftAndMove(start.x, start.y, z);
  for (let i = 1; i < poly.length; i++) {
    extrudeTo(poly[i].x + offsetX, poly[i].y + offsetY);
  }
  extrudeTo(start.x, start.y); // close
}

function printInfill(segments: [Point, Point][], z: number) {
  for (const [a, b] of segments) {
    liftAndMove(a.x, a.y, z);
    extrudeTo(b.x, b.y);
  }
}

// ─── Text path generation ─────────────────────────────────────────────────────

interface PathCommand {
  type: string;
  x?: number; y?: number;
  x1?: number; y1?: number;
  x2?: number; y2?: number;
}

function cubicBezier(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const mt = 1 - t;
  return mt ** 3 * p0 + 3 * mt ** 2 * t * p1 + 3 * mt * t ** 2 * p2 + t ** 3 * p3;
}

function quadBezier(t: number, p0: number, p1: number, p2: number): number {
  const mt = 1 - t;
  return mt ** 2 * p0 + 2 * mt * t * p1 + t ** 2 * p2;
}

/**
 * Convert opentype path commands → array of contour polylines.
 * Coordinates are already in mm (fontSize used for scaling).
 * Y is flipped (opentype uses screen-down convention).
 */
function commandsToContours(commands: PathCommand[]): Point[][] {
  const contours: Point[][] = [];
  let current: Point[] = [];
  let cx = 0, cy = 0;

  for (const cmd of commands) {
    if (cmd.type === "M") {
      if (current.length > 1) contours.push(current);
      current = [{ x: cmd.x!, y: -cmd.y! }];
      cx = cmd.x!; cy = cmd.y!;
    } else if (cmd.type === "L") {
      current.push({ x: cmd.x!, y: -cmd.y! });
      cx = cmd.x!; cy = cmd.y!;
    } else if (cmd.type === "C") {
      // Cubic bezier — sample into line segments
      const steps = Math.max(6, Math.ceil(
        Math.sqrt((cmd.x! - cx) ** 2 + (cmd.y! - cy) ** 2) / 0.3
      ));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        current.push({
          x: cubicBezier(t, cx, cmd.x1!, cmd.x2!, cmd.x!),
          y: -cubicBezier(t, cy, cmd.y1!, cmd.y2!, cmd.y!),
        });
      }
      cx = cmd.x!; cy = cmd.y!;
    } else if (cmd.type === "Q") {
      // Quadratic bezier
      const steps = Math.max(4, Math.ceil(
        Math.sqrt((cmd.x! - cx) ** 2 + (cmd.y! - cy) ** 2) / 0.3
      ));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        current.push({
          x: quadBezier(t, cx, cmd.x1!, cmd.x!),
          y: -quadBezier(t, cy, cmd.y1!, cmd.y!),
        });
      }
      cx = cmd.x!; cy = cmd.y!;
    } else if (cmd.type === "Z") {
      if (current.length > 1) {
        current.push(current[0]); // close
        contours.push(current);
      }
      current = [];
    }
  }
  if (current.length > 1) contours.push(current);
  return contours;
}

// ─── Main G-code generator ───────────────────────────────────────────────────

import type { KeyringConfig, KeyringSizeOption } from "./keyring";
import { getShapePolygon, calcFontSize } from "./keyring";

export async function generateKeyringGcode(
  config: KeyringConfig,
  size: KeyringSizeOption,
  baseHex: string,
  textHex: string,
  baseFilamentName: string,
  textFilamentName: string
): Promise<string> {
  // Reset state
  lines.length = 0;
  currentX = 0; currentY = 0; currentE = 0; currentZ = 0;

  // Load opentype (use parse() — loadSync is deprecated)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const opentype = require("opentype.js");

  const fontPath = path.join(process.cwd(), "public", "fonts", `${config.font}.ttf`);
  if (!fs.existsSync(fontPath)) {
    throw new Error(`Font file not found: ${config.font}.ttf`);
  }
  const fontBuffer = fs.readFileSync(fontPath);
  // Convert Node Buffer → ArrayBuffer for opentype.parse()
  const arrayBuffer = fontBuffer.buffer.slice(
    fontBuffer.byteOffset,
    fontBuffer.byteOffset + fontBuffer.byteLength
  ) as ArrayBuffer;
  const font = opentype.parse(arrayBuffer);

  const fontSize = calcFontSize(config.text, config.font, size) ?? 8;

  // Get text advance width for centering
  const textWidth = font.getAdvanceWidth(config.text, fontSize);
  const startX = -textWidth / 2;

  // Get text paths
  const textPath = font.getPath(config.text, startX, 0, fontSize);
  const textContours = commandsToContours(textPath.commands);

  // Keyring shape polygon (local coords, centered at 0,0)
  const shapePoly = getShapePolygon(config.shapeType, size.widthMm, size.heightMm);

  // Hole center (top-center, in local coords)
  const holeCy = -(size.heightMm / 2 - HOLE_RADIUS - 2);
  const holeCx = 0;

  // Print bed offsets
  const ox = BED_CENTER_X;
  const oy = BED_CENTER_Y;

  // ── G-code header ──────────────────────────────────────────────────────────
  emit(`; printOKAY Keyring`);
  emit(`; Text: "${config.text}"`);
  emit(`; Font: ${config.font}`);
  emit(`; Size: ${size.widthMm}x${size.heightMm}mm (${size.label})`);
  emit(`; Base color: ${baseFilamentName} (${baseHex})`);
  emit(`; Text color: ${textFilamentName} (${textHex})`);
  emit(`; Generated: ${new Date().toISOString()}`);
  emit(``);
  emit(`; --- Printer init ---`);
  emit(`M190 S60        ; Bed temperature PLA`);
  emit(`M109 S220       ; Nozzle temperature PLA`);
  emit(`G28             ; Home all axes`);
  emit(`G21             ; Set units to mm`);
  emit(`G90             ; Absolute positioning`);
  emit(`M82             ; Absolute extrusion`);
  emit(`G92 E0          ; Reset extruder`);
  emit(`G1 Z5 F600      ; Lift before move`);
  emit(`G1 X${ox} Y${oy} F${TRAVEL_SPEED} ; Move to center`);
  emit(``);

  // ── Base layers (color 1: keyring body) ───────────────────────────────────
  emit(`; === BASE LAYERS: ${baseFilamentName} (${baseHex}) ===`);
  emit(`; ${BASE_LAYERS} layers × ${LAYER_HEIGHT}mm = ${BASE_HEIGHT_MM}mm`);
  emit(``);

  // Precompute infill for base shape (expensive, do once)
  const baseInfill = scanlineInfill(shapePoly, ox, oy, { cx: ox + holeCx, cy: oy + holeCy });

  for (let layer = 1; layer <= BASE_LAYERS; layer++) {
    setLayer(layer);
    const z = layer * LAYER_HEIGHT;

    // Perimeter passes (2 concentric walls, outermost first)
    for (let pass = 0; pass < PERIMETER_PASSES; pass++) {
      const insetDist = LINE_WIDTH * pass + LINE_WIDTH / 2;
      const wallPoly = pass === 0 ? shapePoly : offsetPolygon(shapePoly, insetDist);
      emit(`; Perimeter pass ${pass + 1}`);
      printPolygon(wallPoly, ox, oy, z);
    }

    // Hole circle (outer wall — don't fill the hole)
    const holeInset = LINE_WIDTH / 2;
    const holeCircle: Point[] = [];
    for (let i = 0; i < 32; i++) {
      const t = (i / 32) * 2 * Math.PI;
      holeCircle.push({
        x: ox + holeCx + (HOLE_RADIUS + holeInset) * Math.cos(t),
        y: oy + holeCy + (HOLE_RADIUS + holeInset) * Math.sin(t),
      });
    }
    emit(`; Hole perimeter`);
    liftAndMove(holeCircle[0].x, holeCircle[0].y, z);
    for (let i = 1; i < holeCircle.length; i++) {
      extrudeTo(holeCircle[i].x, holeCircle[i].y);
    }
    extrudeTo(holeCircle[0].x, holeCircle[0].y);

    // Infill (alternating direction already handled by scanlineInfill)
    emit(`; Infill`);
    printInfill(baseInfill, z);
  }

  // ── Filament change ────────────────────────────────────────────────────────
  emit(``);
  emit(`; === FILAMENT CHANGE ===`);
  emit(`; Remove: ${baseFilamentName} (${baseHex})`);
  emit(`; Load:   ${textFilamentName} (${textHex})`);
  emit(`G1 Z${(BASE_HEIGHT_MM + 5).toFixed(1)} F600  ; Park nozzle`);
  emit(`M600            ; Filament change (pause until user resumes)`);
  emit(`G92 E0          ; Reset extruder after change`);
  emit(``);

  // ── Text layers (color 2: raised letters) ──────────────────────────────────
  emit(`; === TEXT LAYERS: ${textFilamentName} (${textHex}) ===`);
  emit(`; ${TEXT_LAYERS} layers × ${LAYER_HEIGHT}mm = ${TEXT_HEIGHT_MM}mm raised text`);
  emit(``);

  // Adjust text vertical position: center text in the usable height
  // The text bounding box in opentype y-flipped coords:
  // ascender ≈ fontSize * 0.7 (above baseline), descender ≈ fontSize * 0.3 (below)
  // We shift text so its visual center aligns with keyring center (accounting for hole)
  const usableTop = (size.heightMm / 2) - HOLE_RADIUS - 4; // below hole
  const usableHeight = size.heightMm - HOLE_RADIUS * 2 - 6;
  const textCenterY = -usableTop / 2 + usableHeight / 4;

  for (let layer = BASE_LAYERS + 1; layer <= TOTAL_LAYERS; layer++) {
    setLayer(layer);
    const z = layer * LAYER_HEIGHT;

    emit(`; Text contours`);
    for (const contour of textContours) {
      if (contour.length < 2) continue;
      const gx0 = ox + contour[0].x;
      const gy0 = oy + contour[0].y + textCenterY;

      // Only print contours that are within keyring bounds
      if (!pointInPolygon(gx0 - ox, gy0 - oy, shapePoly)) continue;

      liftAndMove(gx0, gy0, z);
      let didExtrude = false;
      for (let i = 1; i < contour.length; i++) {
        const gx = ox + contour[i].x;
        const gy = oy + contour[i].y + textCenterY;
        extrudeTo(gx, gy);
        didExtrude = true;
      }

      // Second perimeter pass (inner offset ≈ 1 line width)
      if (didExtrude && contour.length > 4) {
        const innerContour = contour.map((p) => {
          const dx = p.x - (contour.reduce((s, c) => s + c.x, 0) / contour.length);
          const dy = p.y - (contour.reduce((s, c) => s + c.y, 0) / contour.length);
          const len = Math.sqrt(dx * dx + dy * dy) || 1;
          return {
            x: p.x - (dx / len) * LINE_WIDTH,
            y: p.y - (dy / len) * LINE_WIDTH,
          };
        });
        liftAndMove(ox + innerContour[0].x, oy + innerContour[0].y + textCenterY, z);
        for (let i = 1; i < innerContour.length; i++) {
          extrudeTo(ox + innerContour[i].x, oy + innerContour[i].y + textCenterY);
        }
      }
    }

    // Text infill — scanline within letter bounding boxes
    emit(`; Text infill`);
    for (const contour of textContours) {
      if (contour.length < 3) continue;
      const gContour = contour.map((p) => ({
        x: p.x + ox,
        y: p.y + oy + textCenterY,
      }));
      // Quick bounds check — skip contours outside keyring
      const cx = gContour.reduce((s, p) => s + p.x, 0) / gContour.length;
      const cy = gContour.reduce((s, p) => s + p.y, 0) / gContour.length;
      if (!pointInPolygon(cx - ox, cy - oy, shapePoly)) continue;

      // Local contour for infill (already in global coords)
      const localContour = gContour.map((p) => ({ x: p.x - ox, y: p.y - oy }));
      const infill = scanlineInfill(localContour, ox, oy);
      printInfill(infill, z);
    }
  }

  // ── End G-code ─────────────────────────────────────────────────────────────
  emit(``);
  emit(`; === END ===`);
  emit(`G1 Z${(TOTAL_HEIGHT + 10).toFixed(1)} F600  ; Raise Z`);
  emit(`G1 X10 Y10 F${TRAVEL_SPEED}    ; Move to corner`);
  emit(`M104 S0          ; Nozzle off`);
  emit(`M140 S0          ; Bed off`);
  emit(`M84              ; Motors off`);
  emit(`; --- Print complete ---`);
  emit(`; Total estimated layers: ${TOTAL_LAYERS}`);
  emit(`; Estimated height: ${TOTAL_HEIGHT}mm`);

  return lines.join("\n");
}
