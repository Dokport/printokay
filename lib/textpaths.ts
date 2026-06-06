/**
 * Text path extraction from opentype.js font data.
 * Used by both the G-code generator and the STL generator.
 */

export type Point = { x: number; y: number };

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
 * Y is flipped (opentype uses screen-down convention, we want math-up).
 * Coordinates are in mm (font is loaded with fontSize = desired mm size).
 */
export function commandsToContours(commands: PathCommand[]): Point[][] {
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
        current.push(current[0]); // close contour
        contours.push(current);
      }
      current = [];
    }
  }
  if (current.length > 1) contours.push(current);
  return contours;
}

/**
 * Load font and extract centered text contours using opentype.js.
 * fontId = filename without .ttf (e.g. "Roboto-Bold")
 * fontSize = desired cap height in mm
 * Returns contours in mm, centered around (0, 0).
 */
export function extractTextContours(
  text: string,
  fontId: string,
  fontSize: number
): Point[][] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const opentype = require("opentype.js");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("path");

  const fontPath = path.join(process.cwd(), "public", "fonts", `${fontId}.ttf`);
  const fontBuffer = fs.readFileSync(fontPath);
  const arrayBuffer = fontBuffer.buffer.slice(
    fontBuffer.byteOffset,
    fontBuffer.byteOffset + fontBuffer.byteLength
  ) as ArrayBuffer;
  const font = opentype.parse(arrayBuffer);

  const textWidth = font.getAdvanceWidth(text, fontSize);
  const startX = -textWidth / 2;
  const textPath = font.getPath(text, startX, 0, fontSize);
  return commandsToContours(textPath.commands);
}
