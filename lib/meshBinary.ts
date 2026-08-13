/**
 * Compact binary wire format for product meshes (isomorphic — no Node APIs).
 *
 * The JSON mesh for a painted model runs to megabytes, and JSON.parse of that is
 * what made the shop's 3D slow to appear on older devices. This format is ~half the
 * size before compression and needs no parsing at all on the client: the payload IS
 * the Float32/Uint32 buffers three.js wants, read as zero-copy typed-array views.
 *
 * Layout (little-endian):
 *   bytes 0-3   magic "PKM1"
 *   bytes 4-7   uint32: length of the JSON header in bytes (padded, see below)
 *   ...         UTF-8 JSON header { positions: <float count>, zones: [{ key, color?, indices: <count> }] }
 *               — space-padded so the section that follows starts 4-byte aligned
 *   ...         Float32Array positions  (header.positions floats)
 *   ...         Uint32Array indices per zone, concatenated in header order
 */
import type { ParsedMesh } from "./threemf";

const MAGIC = 0x314d4b50; // "PKM1" read as LE uint32

type Header = {
  positions: number;
  zones: { key: string; color?: string; indices: number }[];
};

export type BinaryMesh = {
  positions: Float32Array;
  zones: { key: string; color?: string; indices: Uint32Array }[];
};

export function encodeMeshBinary(mesh: ParsedMesh): Uint8Array {
  const header: Header = {
    positions: mesh.positions.length,
    zones: mesh.zones.map((z) => ({
      key: z.key,
      ...(z.color ? { color: z.color } : {}),
      indices: z.indices.length,
    })),
  };
  let headerJson = JSON.stringify(header);
  // Pad so the Float32 section starts on a 4-byte boundary (8 = magic + length).
  while ((8 + headerJson.length) % 4 !== 0) headerJson += " ";
  const headerBytes = new TextEncoder().encode(headerJson);

  const indexCount = mesh.zones.reduce((n, z) => n + z.indices.length, 0);
  const total = 8 + headerBytes.length + mesh.positions.length * 4 + indexCount * 4;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  view.setUint32(0, MAGIC, true);
  view.setUint32(4, headerBytes.length, true);
  out.set(headerBytes, 8);

  let off = 8 + headerBytes.length;
  new Float32Array(out.buffer, off, mesh.positions.length).set(mesh.positions);
  off += mesh.positions.length * 4;
  for (const z of mesh.zones) {
    new Uint32Array(out.buffer, off, z.indices.length).set(z.indices);
    off += z.indices.length * 4;
  }
  return out;
}

export function decodeMeshBinary(buf: ArrayBuffer): BinaryMesh {
  const view = new DataView(buf);
  if (buf.byteLength < 8 || view.getUint32(0, true) !== MAGIC) {
    throw new Error("Ukendt mesh-format");
  }
  const headerLen = view.getUint32(4, true);
  const header: Header = JSON.parse(
    new TextDecoder().decode(new Uint8Array(buf, 8, headerLen))
  );

  let off = 8 + headerLen;
  const positions = new Float32Array(buf, off, header.positions);
  off += header.positions * 4;
  const zones = header.zones.map((z) => {
    const indices = new Uint32Array(buf, off, z.indices);
    off += z.indices * 4;
    return { key: z.key, ...(z.color ? { color: z.color } : {}), indices };
  });
  return { positions, zones };
}
