/**
 * Bambu Studio project (.3mf) with several objects, each made of several parts,
 * each part on its own filament.
 *
 * This is the structure Bambu Studio itself writes (checked against a real file):
 *
 *   3D/3dmodel.model            one <object> per printed thing, holding <components>
 *                               that point into a sub-model file, plus the <build>
 *   3D/Objects/object_N.model   the actual meshes — one <object> per part
 *   Metadata/model_settings.config
 *                               the same objects, with a <part> per component that
 *                               carries `extruder` — this is what colours a part
 *   Metadata/project_settings.config
 *                               filament colours, so the AMS mapping comes up right
 *
 * Per-part filaments are how three colours get onto one keycap; the keyring's
 * per-triangle paint stays where it is, it does one seam well.
 */
import { zipSync, strToU8 } from "fflate";
import type { Tri } from "./keyringMesh";

export type Bambu3mfPart = {
  name: string;
  extruder: number;
  tris: Tri[];
  /**
   * Where this part sits inside its object, in mm. Parts of one object need not
   * touch: a grid of caps with air between them is still one object to the
   * slicer, which is what lets "print by object" run all the caps' colour changes
   * in one go and the single-colour box in another.
   */
  x?: number;
  y?: number;
};
export type Bambu3mfObject = {
  name: string;
  parts: Bambu3mfPart[];
  /** Where on the bed, in mm. Meshes are expected to sit on z=0 around their own origin. */
  x: number;
  y: number;
};
export type Bambu3mfInput = {
  title: string;
  /** Filament colours, index 0 = extruder 1. */
  filamentHex: string[];
  objects: Bambu3mfObject[];
};

const f = (n: number) => (Math.abs(n) < 1e-9 ? "0" : Number(n.toFixed(4)).toString());
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const escapeXml = (s: string) =>
  s.replace(/[<>&"']/g, (ch) =>
    ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === "&" ? "&amp;" : ch === '"' ? "&quot;" : "&apos;");
const normHex = (c: string) => {
  const h = c.replace("#", "").trim();
  return "#" + (h.length === 3 ? h.split("").map((x) => x + x).join("") : h).toUpperCase().padEnd(6, "0").slice(0, 6);
};

function meshXml(tris: Tri[]): string {
  const index = new Map<string, number>();
  const verts: string[] = [];
  const ids = (v: [number, number, number]) => {
    const k = `${f(v[0])},${f(v[1])},${f(v[2])}`;
    let i = index.get(k);
    if (i === undefined) { i = verts.length; index.set(k, i); verts.push(`     <vertex x="${f(v[0])}" y="${f(v[1])}" z="${f(v[2])}"/>`); }
    return i;
  };
  const faces = tris.map(([a, b, c]) => `     <triangle v1="${ids(a)}" v2="${ids(b)}" v3="${ids(c)}"/>`);
  return `    <vertices>\n${verts.join("\n")}\n    </vertices>\n    <triangles>\n${faces.join("\n")}\n    </triangles>`;
}

export function writeBambu3mf(input: Bambu3mfInput): Buffer {
  let nextId = 1;
  let nextUuid = 1;
  const files: Record<string, Uint8Array> = {};
  const mainObjects: string[] = [];
  const buildItems: string[] = [];
  const settingsObjects: string[] = [];
  const rels: string[] = [];
  const instances: string[] = [];

  input.objects.forEach((obj, oi) => {
    const partIds = obj.parts.map(() => nextId++);
    const objectId = nextId++;
    const subPath = `/3D/Objects/object_${objectId}.model`;

    const subObjects = obj.parts.map((part, pi) =>
`  <object id="${partIds[pi]}" p:UUID="${uuid(nextUuid++)}" type="model">
   <mesh>
${meshXml(part.tris)}
   </mesh>
  </object>`);
    files[subPath.slice(1)] = strToU8(
`<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <resources>
${subObjects.join("\n")}
 </resources>
 <build/>
</model>`);
    rels.push(`<Relationship Target="${subPath}" Id="rel-${oi + 2}" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>`);

    mainObjects.push(
`  <object id="${objectId}" p:UUID="${uuid(nextUuid++)}" type="model">
   <components>
${obj.parts.map((part, pi) => `    <component p:path="${subPath}" objectid="${partIds[pi]}" p:UUID="${uuid(nextUuid++)}" transform="1 0 0 0 1 0 0 0 1 ${f(part.x ?? 0)} ${f(part.y ?? 0)} 0"/>`).join("\n")}
   </components>
  </object>`);
    buildItems.push(
`  <item objectid="${objectId}" p:UUID="${uuid(nextUuid++)}" transform="1 0 0 0 1 0 0 0 1 ${f(obj.x)} ${f(obj.y)} 0" printable="1"/>`);

    settingsObjects.push(
`  <object id="${objectId}">
    <metadata key="name" value="${escapeXml(obj.name)}"/>
    <metadata key="extruder" value="${obj.parts[0]?.extruder ?? 1}"/>
${obj.parts.map((part, pi) =>
`    <part id="${partIds[pi]}" subtype="normal_part">
      <metadata key="name" value="${escapeXml(part.name)}"/>
      <metadata key="extruder" value="${part.extruder}"/>
    </part>`).join("\n")}
  </object>`);
    instances.push(
`    <model_instance>
      <metadata key="object_id" value="${objectId}"/>
      <metadata key="instance_id" value="0"/>
      <metadata key="identify_id" value="${100 + oi}"/>
    </model_instance>`);
  });

  files["3D/3dmodel.model"] = strToU8(
`<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
 <metadata name="Application">printOKAY</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <metadata name="Title">${escapeXml(input.title)}</metadata>
 <resources>
${mainObjects.join("\n")}
 </resources>
 <build p:UUID="${uuid(nextUuid++)}">
${buildItems.join("\n")}
 </build>
</model>`);

  files["3D/_rels/3dmodel.model.rels"] = strToU8(
`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 ${rels.join("\n ")}
</Relationships>`);

  files["_rels/.rels"] = strToU8(
`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`);

  files["[Content_Types].xml"] = strToU8(
`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="config" ContentType="application/vnd.bambulab.config+xml"/>
</Types>`);

  files["Metadata/model_settings.config"] = strToU8(
`<?xml version="1.0" encoding="UTF-8"?>
<config>
${settingsObjects.join("\n")}
  <plate>
    <metadata key="plater_id" value="1"/>
    <metadata key="plater_name" value=""/>
    <metadata key="locked" value="false"/>
${instances.join("\n")}
  </plate>
</config>`);

  const n = Math.max(1, input.filamentHex.length);
  files["Metadata/project_settings.config"] = strToU8(JSON.stringify({
    filament_colour: input.filamentHex.map(normHex),
    filament_type: Array(n).fill("PLA"),
    filament_settings_id: Array(n).fill("Generic PLA"),
    filament_ids: Array(n).fill("GFL99"),
    from: "printOKAY",
  }, null, 1));

  return Buffer.from(zipSync(files));
}
