/**
 * Server-side: a fidget clicker as a Bambu Studio project, laid out for printing.
 *
 * Two objects, not one per piece:
 *
 *   "Knapper"       every cap, in a grid with air between them, each cap's body
 *                   and text as parts on their own filaments
 *   "Kasse og låg"  box and lid side by side, one filament
 *
 * With Bambu's "print by object" that means the caps' colour changes happen once,
 * over the caps, and the single-colour box and lid print without a single swap —
 * instead of the printer changing filament on every layer across the whole plate.
 */
import { extractTextContours } from "./textpaths.server";
import { writeBambu3mf, type Bambu3mfObject } from "./bambu3mf";
import {
  buildFidgetMesh, buildFidgetTolerancePlate, CAP_W_MM, type FidgetMesh,
} from "./fidgetMesh";
import { FIDGET_FONT, type FidgetConfig } from "./fidget";

export const FIDGET_3MF_VERSION = 1;

/** Bambu X1C plate. */
const BED_MM = 256;
/** Air between caps in the grid, and between box and lid. */
const CAP_GAP_MM = 6;
const BOX_LID_GAP_MM = 8;
/** Air between the two objects, so "print by object" has room for the nozzle. */
const OBJECT_GAP_MM = 30;

export type FidgetColours = { box: string; cap: string; text: string };

/** Extruder slots: what each role prints with. */
const EXTRUDER = { box: 1, cap: 2, text: 3 } as const;

/**
 * Arrange the mesh into the two objects, centred on the bed. Exported so a test
 * can check the layout without writing a file.
 */
export function layoutFidgetPlate(mesh: FidgetMesh, cfg: FidgetConfig): Bambu3mfObject[] {
  const [box, lid, ...caps] = mesh.objects;

  // Caps: the customer's grid, spaced out.
  const pitch = CAP_W_MM + CAP_GAP_MM;
  const capParts = caps.flatMap((cap, i) => {
    const c = i % cfg.cols, r = Math.floor(i / cfg.cols);
    const x = (c - (cfg.cols - 1) / 2) * pitch;
    const y = ((cfg.rows - 1) / 2 - r) * pitch;
    return cap.parts.map((p) => ({ name: p.name, extruder: EXTRUDER[p.role], tris: p.tris, x, y }));
  });
  const capsH = cfg.rows * pitch;

  // Box and lid: side by side, centred as a pair.
  const pairW = box.size.w + BOX_LID_GAP_MM + lid.size.w;
  const boxX = -pairW / 2 + box.size.w / 2;
  const lidX = pairW / 2 - lid.size.w / 2;
  const boxParts = [
    ...box.parts.map((p) => ({ name: p.name, extruder: EXTRUDER.box, tris: p.tris, x: boxX, y: 0 })),
    ...lid.parts.map((p) => ({ name: p.name, extruder: EXTRUDER.box, tris: p.tris, x: lidX, y: 0 })),
  ];
  const pairH = Math.max(box.size.h, lid.size.h);

  // Stack the two objects along Y, centred on the bed.
  const total = capsH + OBJECT_GAP_MM + pairH;
  const capsY = BED_MM / 2 - total / 2 + capsH / 2;
  const pairY = BED_MM / 2 + total / 2 - pairH / 2;

  return [
    { name: "Knapper", parts: capParts, x: BED_MM / 2, y: capsY },
    { name: "Kasse og låg", parts: boxParts, x: BED_MM / 2, y: pairY },
  ];
}

export function generateFidget3mf(cfg: FidgetConfig, colours: FidgetColours): {
  file: Buffer;
  mesh: FidgetMesh;
} {
  const mesh = buildFidgetMesh(cfg, (text, em) => extractTextContours(text, FIDGET_FONT, em));
  const objects = layoutFidgetPlate(mesh, cfg);
  const labels = cfg.labels.filter(Boolean).join(" ");
  const file = writeBambu3mf({
    title: `Fidget ${cfg.cols}×${cfg.rows}${labels ? ` "${labels}"` : ""}`,
    filamentHex: [colours.box, colours.cap, colours.text],
    objects,
  });
  return { file, mesh };
}

/**
 * The tolerance test as a printable plate: one object, one cap per slot width, each
 * labelled with its own width. Print it, try the caps on a switch, and put the one
 * that fits into the shop's settings.
 */
export function generateFidgetTolerance3mf(capHex = "#f5f5f5", textHex = "#e11d48"): Buffer {
  const { objects, widths } = buildFidgetTolerancePlate((text, em) =>
    extractTextContours(text, FIDGET_FONT, em)
  );
  const pitch = CAP_W_MM + CAP_GAP_MM;
  const parts = objects.flatMap((cap, i) =>
    cap.parts.map((p) => ({
      name: `${p.name} ${widths[i].toFixed(2)}`,
      extruder: EXTRUDER[p.role],
      tris: p.tris,
      x: (i - (objects.length - 1) / 2) * pitch,
      y: 0,
    }))
  );
  return writeBambu3mf({
    title: `Fidget stem-tolerance ${widths.map((w) => w.toFixed(2)).join(" / ")} mm`,
    // Only caps here, so the box slot goes unused; keep the indices lined up with
    // EXTRUDER so a part's filament means the same thing on every plate we write.
    filamentHex: ["#808080", capHex, textHex],
    objects: [{ name: "Tolerancetest", parts, x: BED_MM / 2, y: BED_MM / 2 }],
  });
}
