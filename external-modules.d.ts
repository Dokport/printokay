/**
 * Ambient module declarations for untyped CJS dependencies used by the keyring
 * geometry core (lib/keyringMesh.ts). These ship no .d.ts and have no @types.
 */

declare module "earcut" {
  /** Triangulate a flat [x0,y0,x1,y1,…] vertex list with optional hole indices. */
  const earcut: (data: number[], holeIndices?: number[], dim?: number) => number[];
  export default earcut;
}

declare module "clipper-lib" {
  // clipper-lib exposes a single namespace object (Clipper, ClipperOffset,
  // PolyType, ClipType, PolyFillType, JoinType, EndType, …). It is dynamically
  // shaped; we type it permissively as the default export.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ClipperLib: any;
  export default ClipperLib;
}
