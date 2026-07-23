/**
 * Bambu-compatible 3MF exporter for the keyring configurator (server-side).
 *
 * Where lib/stl.ts emits a single-colour STL (needing a manual filament change in
 * BambuStudio), this emits a 3MF with the TWO colours embedded, so slicing prints
 * them on separate filaments:
 *
 *   - keyring body   (0 → BASE_HEIGHT_MM)         → material 0 (base colour)
 *   - raised text    (BASE_HEIGHT_MM → TOTAL)     → material 1 (text colour)
 *
 * Colours are carried by the STANDARD 3MF Materials extension (`<m:basematerials>`
 * with per-material `displaycolor`, and a per-triangle `pid`/`p1` assignment). Bambu
 * (and every other slicer) reads these on import and sets up the two filaments with
 * exactly these colours — unlike Bambu's proprietary paint metadata, which is
 * ignored on a plain import and falls back to whatever filaments are loaded.
 *
 * Geometry comes from the shared core `buildKeyringMesh` (same mesh as the STL and
 * the 3D preview). Base + text form one watertight solid; each triangle is assigned
 * its material by height (any vertex above the body = text).
 */

import { zipSync, strToU8 } from "fflate";
import type { KeyringConfig, KeyringSizeOption } from "./keyring";
import { extractTextContours } from "./textpaths.server";
import { buildKeyringMesh, repairTJunctions, BASE_HEIGHT_MM, type Tri, type Vec3 } from "./keyringMesh";

// Bump when the 3MF format changes, so already-synced keyrings re-upload to Bambuddy.
export const KEYRING_3MF_VERSION = 2;

// Base uses the object's default material (index 0); text overrides to material 1.
const MATERIALS_ID = "1";
const TEXT_MATERIAL_INDEX = "1";

// A triangle belongs to the raised text if any vertex rises above the body.
const isTextTri = (t: Tri): boolean =>
  Math.max(t[0][2], t[1][2], t[2][2]) > BASE_HEIGHT_MM + 1e-4;

/** Round to 6 decimals and format without exponent (3MF wants plain decimals). */
function f(n: number): string {
  return (Math.round(n * 1e6) / 1e6).toString();
}

/** Weld the triangle soup into indexed vertices + triangles, assigning materials. */
function meshXml(tris: Tri[]): { vertices: string; triangles: string } {
  const index = new Map<string, number>();
  const verts: Vec3[] = [];
  const vid = (v: Vec3): number => {
    const key = `${Math.round(v[0] * 1e5)},${Math.round(v[1] * 1e5)},${Math.round(v[2] * 1e5)}`;
    let id = index.get(key);
    if (id === undefined) { id = verts.length; verts.push(v); index.set(key, id); }
    return id;
  };

  const triLines: string[] = [];
  for (const t of tris) {
    const a = vid(t[0]), b = vid(t[1]), c = vid(t[2]);
    if (a === b || b === c || a === c) continue; // drop degenerate
    // Base triangles inherit the object's default material (0); text overrides to 1.
    const mat = isTextTri(t) ? ` pid="${MATERIALS_ID}" p1="${TEXT_MATERIAL_INDEX}"` : "";
    triLines.push(`   <triangle v1="${a}" v2="${b}" v3="${c}"${mat}/>`);
  }

  const vertLines = verts.map((v) => `   <vertex x="${f(v[0])}" y="${f(v[1])}" z="${f(v[2])}"/>`);
  return { vertices: vertLines.join("\n"), triangles: triLines.join("\n") };
}

function normHex(c: string): string {
  const h = (c || "").trim().replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(h) ? "#" + h.toUpperCase() : "#888888";
}
// 3MF displaycolor is #RRGGBBAA.
const hex8 = (c: string): string => normHex(c) + "FF";

/**
 * Build a Bambu-compatible 3MF for a keyring, with the base + text colours embedded.
 * `baseHex` / `textHex` are the customer's chosen filament colours (# RRGGBB).
 */
export async function generateKeyring3mf(
  config: KeyringConfig,
  size: KeyringSizeOption,
  baseHex: string,
  textHex: string
): Promise<Buffer> {
  const fontSize = config.fontSize > 0
    ? config.fontSize
    : Math.min(size.widthMm, size.heightMm) * 0.5;

  const rawContours = extractTextContours(config.text, config.font, fontSize);
  const { base, text } = buildKeyringMesh(rawContours, config, size);
  // One watertight solid (repair fixes T-junctions across the base/text seam).
  const { vertices, triangles } = meshXml(repairTJunctions([...base, ...text]));

  const name = (config.text || "Nøglering").slice(0, 40);

  // Standard Materials extension: object defaults to material 0 (base); text = 1.
  const model =
`<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02">
 <metadata name="Application">printOKAY</metadata>
 <metadata name="Title">${escapeXml(name)}</metadata>
 <resources>
  <m:basematerials id="${MATERIALS_ID}">
   <m:base name="Base" displaycolor="${hex8(baseHex)}"/>
   <m:base name="Tekst" displaycolor="${hex8(textHex)}"/>
  </m:basematerials>
  <object id="2" type="model" pid="${MATERIALS_ID}" pindex="0">
   <mesh>
    <vertices>
${vertices}
    </vertices>
    <triangles>
${triangles}
    </triangles>
   </mesh>
  </object>
 </resources>
 <build>
  <item objectid="2" transform="1 0 0 0 1 0 0 0 1 128 128 0" printable="1"/>
 </build>
</model>`;

  // Also mirror the colours into Bambu's project settings, so opening as a project
  // (rather than a plain import) still shows the two filaments correctly.
  const projectSettings = JSON.stringify({
    filament_colour: [normHex(baseHex), normHex(textHex)],
    filament_type: ["PLA", "PLA"],
    filament_settings_id: ["Generic PLA", "Generic PLA"],
    filament_ids: ["GFL99", "GFL99"],
    from: "printOKAY",
  }, null, 1);

  const contentTypes =
`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="config" ContentType="application/vnd.bambulab.config+xml"/>
 <Default Extension="png" ContentType="image/png"/>
</Types>`;

  const rels =
`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

  const zipped = zipSync({
    "[Content_Types].xml": strToU8(contentTypes),
    "_rels/.rels": strToU8(rels),
    "3D/3dmodel.model": strToU8(model),
    "Metadata/project_settings.config": strToU8(projectSettings),
  });

  return Buffer.from(zipped);
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (ch) =>
    ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === "&" ? "&amp;" : ch === '"' ? "&quot;" : "&apos;"
  );
}
