/**
 * Server-only font loading (uses Node `fs`). Keep this OUT of any client bundle —
 * the browser path fetches the font and calls `contoursFromFont` directly.
 */

import { contoursFromFont, type OpenTypeFontLike, type Point } from "./textpaths";

/**
 * Load a font from public/fonts and extract centered text contours.
 * fontId = filename without .ttf (e.g. "Roboto-Bold").
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
  const font = opentype.parse(arrayBuffer) as OpenTypeFontLike;

  return contoursFromFont(font, text, fontSize);
}
