/**
 * Isomorphic fidget-clicker geometry (no Node APIs — server and browser alike).
 *
 * Everything is generated: a box, a lid that doubles as the MX switch plate, and one
 * cap per switch with the customer's text as a flush two-colour inlay. Real Cherry-MX
 * switches clip into the lid; nothing else is bought in.
 *
 * Solids are built as LAYERED PRISMS: a stack of z-ranges, each with its own 2D
 * cross-section. Where the section changes, the difference between the two sections
 * becomes a horizontal face (up where material ends, down where it begins). Every
 * vertical edge is shared by exactly two triangles, so each solid is a single
 * watertight manifold — no booleans in 3D, only clipper in 2D.
 *
 * Caps are modelled upright and then turned over, because they print top-down: the
 * top face lands on the bed for a glass finish, the text inlay and its surround are
 * the first layers side by side, and the stem prints as a clean vertical hole.
 */
import ClipperLib from "clipper-lib";
import type { Point } from "./textpaths";
import {
  cleanUnion, faceTriangles, wall, groupByDepth, circle, rect, repairTJunctions,
  type Tri, type Group,
} from "./keyringMesh";
import { MAX_CAP_CHARS, normalizeLabels, type FidgetConfig } from "./fidget";

type P2 = Point;

// ─── Cherry MX plate-mount standard ───────────────────────────────────────────
export const PITCH_MM   = 19.05; // switch centre to centre
export const CUTOUT_MM  = 14.0;  // square plate opening
export const PLATE_T_MM = 1.5;   // plate thickness the switch clips grip

// ─── Cap ──────────────────────────────────────────────────────────────────────
export const CAP_W_MM     = 18.0;
export const CAP_H_MM     = 8.0;
const CAP_R_MM            = 2.0;  // corner radius
export const CAP_WALL_MM  = 1.2;
const CAP_TOP_T_MM        = 2.2;  // solid top, inlay included
export const INLAY_T_MM   = 0.8;  // depth of the text inlay
/** Where the text may go on the cap top: comfortably inside the corner radii. */
const TEXT_BOX_W_MM = 13.0, TEXT_BOX_H_MM = 9.0;
/**
 * Below this the inlay's colour boundary is thinner than a nozzle and the letters
 * bleed into the cap. Flush inlay has no walls, so it prints smaller than the
 * keyring's raised text — but not smaller than this.
 */
export const MIN_INLAY_CAP_HEIGHT_MM = 2.5;

// ─── Stem: female cross for a standard MX stem ────────────────────────────────
const STEM_BOSS_R_MM = 2.8;   // Ø5.6 boss under the cap top
const STEM_DEPTH_MM  = 3.8;   // how far the cross reaches up into the boss
const CROSS_LEN_MM   = 4.15;  // cross arm length, tip to tip
/**
 * Width of the cross slot — the one dimension that decides whether a cap grips.
 *
 * A Cherry stem's cross is about 1.17mm wide, so the socket is cut wider to leave
 * room. How much wider is a property of the PRINTER, not the switch: a slot this
 * size closes up by a couple of tenths on an FDM machine, and by different amounts
 * depending on filament and flow. It is settable so it can be dialled in from a
 * test print rather than guessed — see buildFidgetTolerancePlate.
 */
export const DEFAULT_CROSS_W_MM = 1.35;

// ─── Box ──────────────────────────────────────────────────────────────────────
const BOX_WALL_MM      = 2.0;
const BOX_R_MM         = 3.0;
const FLOOR_T_MM       = 2.0;
/**
 * How far a switch hangs below the plate's underside: the lower housing reaches
 * about 3.5mm down, and the pins about 3.3mm below that.
 *
 * Clipping the pins buys nothing — the centre guide post reaches just as far down
 * as the contacts do, so this depth is needed whatever is done to the legs. It is
 * the ONLY thing setting the box height, so it is named rather than folded into
 * the cavity number.
 */
const SWITCH_BELOW_PLATE_MM = 7.0;
const SWITCH_AIR_MM         = 1.5;  // so nothing lands hard on the floor
const CAVITY_H_MM      = SWITCH_BELOW_PLATE_MM + SWITCH_AIR_MM;
const CAVITY_MARGIN_MM = 1.0;  // cavity beyond the outermost switch pitch cell
const RIM_STEP_MM      = 1.0;  // the lid sits in a recess this deep into the wall
/**
 * The optional keyring eye: a lug off the left end of the box with a 5mm hole.
 *
 * It lives in the FLOOR, not up the wall, so it prints flat on the bed with no
 * support and the hole comes out round. It is sunk into the box the same way the
 * oval keyring's eye is — most of the material around the hole is box wall rather
 * than an added stalk, which is what a lug snaps off at.
 */
const EYE_HOLE_R_MM     = 2.5;
const EYE_WALL_MM       = 3.0;   // material around the hole
const EYE_PROTRUSION_MM = 6.0;   // how far the eye stands out past the box
const EYE_BLEND_MM      = 2.5;   // fillet where the eye meets the box
const EYE_OVERLAP_MM    = 3.0;   // how far the lug reaches into the box, so the two merge
const LID_CLEARANCE_MM = 0.15;
/**
 * How far a cap's skirt sits above the plate once it is on a switch. A Cherry MX
 * stands about 11.6mm proud of the plate and the cap swallows the top of that.
 */
export const CAP_RIDE_HEIGHT_MM = 6.2;
/**
 * The lid carries a frame around the caps, tall enough to hide the lower half of
 * them. Without it the caps appear to float: the switch itself is a bought part and
 * is not in the model, so the gap it fills reads as a mistake.
 *
 * The frame is on the LID, not the box. On the box it would trap the lid — a lid
 * cannot drop into a well that is walled above it.
 */
const BEZEL_HIDES_MM = CAP_H_MM / 2;
/** Gap between the frame and the caps, so a pressed cap never rubs. */
const BEZEL_CLEARANCE_MM = 0.7;

const SCALE = 1000;
type IPt = { X: number; Y: number };
const toC = (poly: P2[]): IPt[] => poly.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));
const fromC = (poly: IPt[]): P2[] => poly.map((p) => ({ x: p.X / SCALE, y: p.Y / SCALE }));

/** Grow a region outward with round joins. */
function dilate(region: P2[][], deltaMm: number): P2[][] {
  const co = new ClipperLib.ClipperOffset(2.0, SCALE * 0.05);
  co.AddPaths(region.filter((p) => p.length >= 3).map(toC), ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
  const out: IPt[][] = [];
  co.Execute(out, deltaMm * SCALE);
  return out.filter((p) => p.length >= 3).map(fromC);
}

/** Boolean on contour sets. Result is clean, disjoint, orientation-normalised. */
function clip(
  a: P2[][], b: P2[][],
  op: "union" | "difference" | "intersection"
): P2[][] {
  const c = new ClipperLib.Clipper();
  c.AddPaths(a.filter((p) => p.length >= 3).map(toC), ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(b.filter((p) => p.length >= 3).map(toC), ClipperLib.PolyType.ptClip, true);
  const out: IPt[][] = [];
  const type = op === "union" ? ClipperLib.ClipType.ctUnion
    : op === "difference" ? ClipperLib.ClipType.ctDifference
    : ClipperLib.ClipType.ctIntersection;
  c.Execute(type, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return out.filter((p) => p.length >= 3).map(fromC);
}

export function roundedRect(cx: number, cy: number, w: number, h: number, r: number, steps = 8): P2[] {
  const hw = w / 2, hh = h / 2;
  const rr = Math.min(r, hw, hh);
  const pts: P2[] = [];
  const corner = (ox: number, oy: number, a0: number) => {
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (i / steps) * (Math.PI / 2);
      pts.push({ x: cx + ox + rr * Math.cos(a), y: cy + oy + rr * Math.sin(a) });
    }
  };
  corner(hw - rr, hh - rr, 0);
  corner(-hw + rr, hh - rr, Math.PI / 2);
  corner(-hw + rr, -hh + rr, Math.PI);
  corner(hw - rr, -hh + rr, 1.5 * Math.PI);
  return pts;
}

/** The MX cross, as a single polygon (two rectangles unioned). */
function crossPolygon(cx: number, cy: number, crossW: number): P2[][] {
  const l = CROSS_LEN_MM / 2, w = crossW / 2;
  return clip([rect(cx - l, cy - w, cx + l, cy + w)], [rect(cx - w, cy - l, cx + w, cy + l)], "union");
}

// ─── Layered prism ────────────────────────────────────────────────────────────

type Layer = { z0: number; z1: number; region: P2[][] };

/**
 * A watertight solid from a stack of cross-sections. Each layer's region is any set
 * of contours (clipper works out outers and holes). Faces are only emitted where
 * material actually starts or stops, so a section that continues unchanged into
 * the next layer produces no internal face.
 *
 * Every layer is resolved into canonical groups exactly ONCE, and those same
 * polygons make both its walls and its own faces. Running a region through clipper
 * a second time can move a vertex by a micron or drop a collinear one, and a wall
 * and a face that disagree by that much are not a manifold. Only the transitions
 * between layers need a fresh clip; what that leaves behind are T-junctions on
 * shared edges, which the repair closes.
 */
function layeredPrism(layers: Layer[]): Tri[] {
  const tris: Tri[] = [];
  const canonical = layers.map((l) => groupByDepth(cleanUnion(l.region)));
  const polysOf = (groups: Group[]): P2[][] => groups.flatMap((g) => [g.outer, ...g.holes]);
  const emit = (groups: Group[], z: number, up: boolean) => {
    for (const g of groups) tris.push(...faceTriangles(g.outer, g.holes, z, up));
  };

  emit(canonical[0], layers[0].z0, false);
  layers.forEach((layer, i) => {
    if (i > 0) {
      const here = polysOf(canonical[i]), below = polysOf(canonical[i - 1]);
      // Material that begins here faces down; material that ended below faces up.
      emit(groupByDepth(clip(here, below, "difference")), layer.z0, false);
      emit(groupByDepth(clip(below, here, "difference")), layer.z0, true);
    }
    for (const g of canonical[i]) {
      tris.push(...wall(g.outer, layer.z0, layer.z1, true));
      for (const h of g.holes) tris.push(...wall(h, layer.z0, layer.z1, false));
    }
  });
  emit(canonical[canonical.length - 1], layers[layers.length - 1].z1, true);

  // Everything came off clipper's 1µm grid; pin it there so equal points are equal.
  const snap = (v: number) => Math.round(v * 1000) / 1000;
  return repairTJunctions(
    tris.map(([a, b, c]) => [
      [snap(a[0]), snap(a[1]), snap(a[2])],
      [snap(b[0]), snap(b[1]), snap(b[2])],
      [snap(c[0]), snap(c[1]), snap(c[2])],
    ])
  );
}

/**
 * Turn a solid upside down for printing: a half turn about the X axis, so the top
 * lands on the bed.
 *
 * It has to be a ROTATION, not a mirror. Mirroring in z (z → h − z) looked the same
 * on screen but reverses handedness, and the customer's name came out mirrored the
 * moment the printed cap was turned back over. A rotation keeps handedness, so no
 * winding fix is needed either.
 */
function upsideDown(tris: Tri[], height: number): Tri[] {
  return tris.map(([a, b, c]) => [
    [a[0], -a[1], height - a[2]],
    [b[0], -b[1], height - b[2]],
    [c[0], -c[1], height - c[2]],
  ]);
}

// ─── Public shape ─────────────────────────────────────────────────────────────

export type FidgetRole = "box" | "cap" | "text";
export type FidgetPart = { name: string; role: FidgetRole; tris: Tri[] };
export type FidgetObject = {
  name: string;
  parts: FidgetPart[];
  /** Footprint on the bed, for laying objects out. */
  size: { w: number; h: number; z: number };
};
export type FidgetMesh = {
  objects: FidgetObject[];
  /** Achieved letter height per cap, row-major; null for a blank cap. */
  capHeightsMm: (number | null)[];
  /** Outer box dimensions, for the read-out. */
  boxMm: { w: number; h: number; z: number };
  /**
   * The keyring eye's hole in the box's own frame, or null when the box has no eye.
   * The bore runs the full height of the box, so it is a position in XY only.
   */
  eyeMm: { cx: number; cy: number; r: number } | null;
};

/** Glyph outlines for a label at a given em size, centred on (0,0). Supplied by the caller. */
export type GlyphSource = (text: string, fontSizeMm: number) => P2[][];

/** Switch centre in the lid's coordinate frame, row-major from the top-left. */
export function switchCentre(cfg: Pick<FidgetConfig, "cols" | "rows">, index: number): P2 {
  const c = index % cfg.cols, r = Math.floor(index / cfg.cols);
  return {
    x: (c - (cfg.cols - 1) / 2) * PITCH_MM,
    y: ((cfg.rows - 1) / 2 - r) * PITCH_MM,
  };
}

function bbox(contours: P2[][]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of contours) for (const p of c) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

/**
 * The text inlay for one cap: glyphs scaled to fill the text box, centred. Returns
 * the contours and the letter height actually achieved (cap height of the font,
 * which for Roboto Bold is 0.711 of the em).
 */
/**
 * The text for every cap, at ONE size.
 *
 * Fitting each cap to its own box would make "A" tower over "MMM" on the same
 * clicker. The scale is set by whichever label needs the most shrinking, and every
 * cap then gets that — so the lettering matches across the product no matter how
 * many characters each key carries.
 */
function capInlays(
  glyphs: GlyphSource,
  labels: string[]
): { inlays: (P2[][] | null)[]; capHeightMm: number | null } {
  const em = 10;
  const drawn = labels.map((label) => {
    const text = label.trim().slice(0, MAX_CAP_CHARS);
    if (!text) return null;
    const raw = glyphs(text, em);
    if (!raw.length) return null;
    const b = bbox(raw);
    return b.w > 0 && b.h > 0 ? { raw, b } : null;
  });

  let scale = Infinity;
  for (const d of drawn) {
    if (!d) continue;
    scale = Math.min(scale, TEXT_BOX_W_MM / d.b.w, TEXT_BOX_H_MM / d.b.h);
  }
  if (!Number.isFinite(scale)) return { inlays: labels.map(() => null), capHeightMm: null };

  const inlays = drawn.map((d) => {
    if (!d) return null;
    const cx = (d.b.x0 + d.b.x1) / 2, cy = (d.b.y0 + d.b.y1) / 2;
    return cleanUnion(d.raw.map((c) => c.map((p) => ({ x: (p.x - cx) * scale, y: (p.y - cy) * scale }))));
  });
  return { inlays, capHeightMm: em * 0.711 * scale };
}

export function buildFidgetMesh(
  cfg: FidgetConfig,
  glyphs: GlyphSource,
  crossW = DEFAULT_CROSS_W_MM
): FidgetMesh {
  const labels = normalizeLabels(cfg);
  const n = cfg.cols * cfg.rows;

  // ── Footprints ──
  const cavityW = cfg.cols * PITCH_MM + 2 * CAVITY_MARGIN_MM;
  const cavityH = cfg.rows * PITCH_MM + 2 * CAVITY_MARGIN_MM;
  const boxW = cavityW + 2 * BOX_WALL_MM, boxH = cavityH + 2 * BOX_WALL_MM;
  const rimW = cavityW + 2 * RIM_STEP_MM, rimH = cavityH + 2 * RIM_STEP_MM;
  const lidW = rimW - 2 * LID_CLEARANCE_MM, lidH = rimH - 2 * LID_CLEARANCE_MM;

  const outer  = [roundedRect(0, 0, boxW, boxH, BOX_R_MM)];
  const cavity = [roundedRect(0, 0, cavityW, cavityH, BOX_R_MM - BOX_WALL_MM)];
  const rim    = [roundedRect(0, 0, rimW, rimH, BOX_R_MM - BOX_WALL_MM + RIM_STEP_MM)];
  const lid    = [roundedRect(0, 0, lidW, lidH, BOX_R_MM - BOX_WALL_MM + RIM_STEP_MM - LID_CLEARANCE_MM)];

  // ── Optional keyring eye, off the left end ──
  const eyeR = EYE_HOLE_R_MM + EYE_WALL_MM;
  const eyeCX = -boxW / 2 - EYE_PROTRUSION_MM + eyeR;

  /**
   * Only the lump that hangs OUTSIDE the box, filleted where it meets it.
   *
   * The obvious route — erode the whole box with the eye, then dilate — puts the
   * box's own outline back through clipper, which re-samples the rounded corners at
   * different points than roundedRect did. The far corners then disagree between the
   * layer that has the eye and the layer above it by a fraction of a micron, and the
   * mesh is no longer closed. Adding only the outside lump leaves every vertex away
   * from the eye exactly as it was.
   */
  const eyeAddition = ((): P2[][] => {
    if (!cfg.keyring) return [];
    const eroded = clip(
      [roundedRect(0, 0, boxW - 2 * EYE_BLEND_MM, boxH - 2 * EYE_BLEND_MM, Math.max(0.5, BOX_R_MM - EYE_BLEND_MM))],
      [circle(eyeCX, 0, eyeR - EYE_BLEND_MM, 48)],
      "union"
    );
    // Windowed to the eye, and reaching a few millimetres INTO the box.
    //
    // Subtracting the box instead would leave the lump merely touching it along the
    // wall, and clipper keeps two polygons that touch without overlapping — the
    // shared edge then gets a wall from each of them and the mesh is open. Real
    // overlap merges. The window keeps the dilate's arc sampling away from the box's
    // far corners, which is what has to stay untouched.
    const half = eyeR + EYE_BLEND_MM + 2;
    const window = rect(eyeCX - half, -half, -boxW / 2 + EYE_OVERLAP_MM, half);
    return clip(dilate(eroded, EYE_BLEND_MM), [window], "intersection");
  })();

  const withEye = (region: P2[][]): P2[][] => {
    if (!eyeAddition.length) return region;
    return clip(clip(region, eyeAddition, "union"), [circle(eyeCX, 0, EYE_HOLE_R_MM, 40)], "difference");
  };

  // ── Box: floor, walls, then a thinner rim the lid drops into ──
  const zWallTop = FLOOR_T_MM + CAVITY_H_MM;
  const boxZ = zWallTop + PLATE_T_MM;
  // The eye runs the FULL height of the box. Stopping it partway would put a layer
  // boundary right where its fillet runs tangentially back into the box wall, and two
  // nearly-tangent outlines crossing there leave hundredth-of-a-millimetre slivers
  // that have a face and no wall. Full height removes the boundary instead of trying
  // to clean up after it — and a lug as tall as the box is what carries a keyring
  // anyway.
  const box = layeredPrism([
    { z0: 0,          z1: FLOOR_T_MM, region: withEye(outer) },
    { z0: FLOOR_T_MM, z1: zWallTop,   region: withEye(clip(outer, cavity, "difference")) },
    { z0: zWallTop,   z1: boxZ,       region: withEye(clip(outer, rim, "difference")) },
  ]);

  // ── Lid = switch plate ──
  const cutouts: P2[][] = [];
  for (let i = 0; i < n; i++) {
    const c = switchCentre(cfg, i);
    cutouts.push(rect(c.x - CUTOUT_MM / 2, c.y - CUTOUT_MM / 2, c.x + CUTOUT_MM / 2, c.y + CUTOUT_MM / 2));
  }
  // The frame stands around the whole cap field; it cannot pass between caps, which
  // sit only about a millimetre apart.
  const fieldW = (cfg.cols - 1) * PITCH_MM + CAP_W_MM + 2 * BEZEL_CLEARANCE_MM;
  const fieldH = (cfg.rows - 1) * PITCH_MM + CAP_W_MM + 2 * BEZEL_CLEARANCE_MM;
  const capWell = [roundedRect(0, 0, fieldW, fieldH, CAP_R_MM + BEZEL_CLEARANCE_MM)];
  const bezelTop = PLATE_T_MM + CAP_RIDE_HEIGHT_MM + BEZEL_HIDES_MM;
  const lidTris = layeredPrism([
    { z0: 0,           z1: PLATE_T_MM, region: clip(lid, cutouts, "difference") },
    { z0: PLATE_T_MM,  z1: bezelTop,   region: clip(lid, capWell, "difference") },
  ]);

  const objects: FidgetObject[] = [
    {
      name: "Kasse",
      parts: [{ name: "Kasse", role: "box", tris: box }],
      size: { w: boxW + (cfg.keyring ? EYE_PROTRUSION_MM : 0), h: boxH, z: boxZ },
    },
    { name: "Låg",   parts: [{ name: "Låg",   role: "box", tris: lidTris }], size: { w: lidW, h: lidH, z: bezelTop } },
  ];

  // ── Caps ──
  const capOuter = [roundedRect(0, 0, CAP_W_MM, CAP_W_MM, CAP_R_MM)];
  const capInner = [roundedRect(0, 0, CAP_W_MM - 2 * CAP_WALL_MM, CAP_W_MM - 2 * CAP_WALL_MM, Math.max(0.5, CAP_R_MM - CAP_WALL_MM))];
  const skirt = clip(capOuter, capInner, "difference");
  const boss = clip([circle(0, 0, STEM_BOSS_R_MM, 48)], crossPolygon(0, 0, crossW), "difference");
  const zCeiling = CAP_H_MM - CAP_TOP_T_MM;
  const zInlay = CAP_H_MM - INLAY_T_MM;

  const { inlays, capHeightMm } = capInlays(glyphs, labels);
  const capHeightsMm: (number | null)[] = [];
  for (let i = 0; i < n; i++) {
    const inlay = inlays[i];
    capHeightsMm.push(inlay ? capHeightMm : null);
    const topRegion = inlay ? clip(capOuter, inlay, "difference") : capOuter;

    const body = layeredPrism([
      { z0: 0,                          z1: zCeiling - STEM_DEPTH_MM, region: skirt },
      { z0: zCeiling - STEM_DEPTH_MM,   z1: zCeiling,                 region: clip(skirt, boss, "union") },
      { z0: zCeiling,                   z1: zInlay,                   region: capOuter },
      { z0: zInlay,                     z1: CAP_H_MM,                 region: topRegion },
    ]);
    const parts: FidgetPart[] = [{ name: `Knap ${i + 1}`, role: "cap", tris: upsideDown(body, CAP_H_MM) }];
    if (inlay) {
      const text = layeredPrism([{ z0: zInlay, z1: CAP_H_MM, region: inlay }]);
      parts.push({ name: `Tekst ${i + 1}`, role: "text", tris: upsideDown(text, CAP_H_MM) });
    }
    objects.push({
      name: labels[i] ? `Knap ${i + 1} "${labels[i]}"` : `Knap ${i + 1}`,
      parts,
      size: { w: CAP_W_MM, h: CAP_W_MM, z: CAP_H_MM },
    });
  }

  return {
    objects,
    capHeightsMm,
    boxMm: { w: boxW + (cfg.keyring ? EYE_PROTRUSION_MM : 0), h: boxH, z: boxZ },
    eyeMm: cfg.keyring ? { cx: eyeCX, cy: 0, r: EYE_HOLE_R_MM } : null,
  };
}

/**
 * A row of caps with the cross slot cut a little wider each time, for finding what
 * this printer actually needs.
 *
 * There are no measurements to work from and none coming, so the fit is settled the
 * only way that is really reliable anyway: print the row, push each cap onto a
 * switch, and keep the width of the first one that holds without force.
 */
export function buildFidgetTolerancePlate(
  glyphs: GlyphSource,
  widths: number[] = [1.25, 1.35, 1.45, 1.55]
): { objects: FidgetObject[]; widths: number[] } {
  const objects = widths.map((w) => {
    // Label each cap with its own width, so a cap that fits can be identified after
    // it has been taken off the plate.
    const label = w.toFixed(2).replace("0.", ".").slice(-3);
    const one = buildFidgetMesh(
      {
        cols: 1, rows: 1, labels: [label],
        boxFilamentId: "", capFilamentId: "", textFilamentId: "",
      },
      glyphs,
      w
    );
    const cap = one.objects[2];
    return { ...cap, name: `Knap ${w.toFixed(2)} mm` };
  });
  return { objects, widths };
}


/**
 * Where each piece sits in the finished clicker, and which way up.
 *
 * The caps come out of buildFidgetMesh already turned over, because that is how
 * they print. Showing the product means turning them back: a half turn about X,
 * the exact inverse. After it the cap occupies z −CAP_H_MM..0, so its skirt lands
 * on `z` once the mesh is lifted by its own height.
 */
export type AssemblyPlacement = { x: number; y: number; z: number; rotX: number };

export function assemblyPlacements(
  cfg: Pick<FidgetConfig, "cols" | "rows">,
  mesh: FidgetMesh
): { box: AssemblyPlacement; lid: AssemblyPlacement; caps: AssemblyPlacement[] } {
  const lidZ = mesh.boxMm.z - PLATE_T_MM; // the lid drops into the rim recess
  return {
    box: { x: 0, y: 0, z: 0, rotX: 0 },
    lid: { x: 0, y: 0, z: lidZ, rotX: 0 },
    caps: Array.from({ length: cfg.cols * cfg.rows }, (_, i) => {
      const c = switchCentre(cfg, i);
      return {
        x: c.x, y: c.y,
        z: mesh.boxMm.z + CAP_RIDE_HEIGHT_MM + CAP_H_MM,
        rotX: Math.PI,
      };
    }),
  };
}
