/**
 * Binary STL generator for the printOKAY keyring configurator (server-side).
 *
 * The actual geometry lives in the isomorphic core `lib/keyringMesh.ts`
 * (shared with the client 3D preview). This file only:
 *   1. loads the font from disk and extracts text contours (Node-only),
 *   2. builds the mesh via `buildKeyringMesh`,
 *   3. repairs T-junctions and encodes the watertight result to binary STL.
 *
 * Produces ONE watertight, manifold STL:
 *   - keyring body  0 → BASE_HEIGHT_MM
 *   - raised text   BASE_HEIGHT_MM → TOTAL_HEIGHT_MM, integrated into the body.
 *
 * For 2-color printing: in BambuStudio add a filament change at Z = BASE_HEIGHT_MM.
 */

import type { KeyringConfig, KeyringSizeOption } from "./keyring";
import { extractTextContours } from "./textpaths.server";
import { buildKeyringMesh, repairTJunctions, type Tri } from "./keyringMesh";

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

// ─── Main STL generator ───────────────────────────────────────────────────────

export async function generateKeyringStl(
  config: KeyringConfig,
  size: KeyringSizeOption
): Promise<Buffer> {
  const fontSize = config.fontSize > 0
    ? config.fontSize
    : Math.min(size.widthMm, size.heightMm) * 0.5;

  const rawContours = extractTextContours(config.text, config.font, fontSize);
  const { base, text } = buildKeyringMesh(rawContours, config, size);

  // Repair any T-junctions across the combined mesh → fully watertight, then encode.
  return encodeStl(repairTJunctions([...base, ...text]));
}
