"use client";

/**
 * 3D preview of the fidget clicker — the finished thing, not the print plate.
 *
 * Geometry comes from the same `buildFidgetMesh` the 3MF is written from, so what
 * the customer turns around on screen is what comes off the printer. Only the
 * arrangement differs: here the lid sits in the box and the caps ride on their
 * switches, rather than lying flat with air between them.
 */
import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Bounds } from "@react-three/drei";
import * as THREE from "three";
import { loadFont } from "@/lib/fontLoader";
import { contoursFromFont, type OpenTypeFontLike } from "@/lib/textpaths";
import {
  buildFidgetMesh, assemblyPlacements, type FidgetMesh, type FidgetObject, type FidgetRole,
} from "@/lib/fidgetMesh";
import { FIDGET_FONT, normalizeLabels, type FidgetConfig } from "@/lib/fidget";
import type { Tri } from "@/lib/keyringMesh";

function trisToGeometry(tris: Tri[]): THREE.BufferGeometry {
  const positions = new Float32Array(tris.length * 9);
  let o = 0;
  for (const t of tris) {
    for (const v of t) { positions[o++] = v[0]; positions[o++] = v[1]; positions[o++] = v[2]; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

type Piece = {
  geometry: THREE.BufferGeometry;
  role: FidgetRole;
  pos: [number, number, number];
  rotX: number;
};

export type FidgetPreviewProps = {
  config: FidgetConfig;
  boxColor: string;
  capColor: string;
  textColor: string;
  crossWidthMm?: number;
  /** Handed the built mesh, so the configurator can read dimensions off it. */
  onMeasure?: (mesh: FidgetMesh) => void;
};

export default function FidgetPreview3D({
  config, boxColor, capColor, textColor, crossWidthMm, onMeasure,
}: FidgetPreviewProps) {
  const [fontObj, setFontObj] = useState<OpenTypeFontLike | null>(null);
  const [fontError, setFontError] = useState(false);

  useEffect(() => {
    let alive = true;
    loadFont(FIDGET_FONT)
      .then((f) => { if (alive) setFontObj(f); })
      .catch(() => { if (alive) setFontError(true); });
    return () => { alive = false; };
  }, []);

  // Compared by value: the config object is rebuilt on every keystroke, so its
  // identity says nothing about whether the geometry actually changed.
  // JSON, not a joined string: a separator would have to be a character no label
  // can ever contain, and getting that wrong silently turns "MMM" into three caps.
  const labelKey = JSON.stringify(normalizeLabels(config));
  const { cols, rows } = config;

  const built = useMemo(() => {
    if (!fontObj) return null;
    try {
      return buildFidgetMesh(
        { ...config, labels: JSON.parse(labelKey) as string[] },
        (text, em) => contoursFromFont(fontObj, text, em),
        crossWidthMm
      );
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontObj, cols, rows, labelKey, crossWidthMm]);

  useEffect(() => { if (built && onMeasure) onMeasure(built); }, [built, onMeasure]);

  const pieces = useMemo<Piece[] | null>(() => {
    if (!built) return null;
    const place = assemblyPlacements({ cols, rows }, built);
    const [box, lid, ...caps] = built.objects;
    const out: Piece[] = [];
    const push = (o: FidgetObject, p: { x: number; y: number; z: number; rotX: number }) => {
      for (const part of o.parts) {
        out.push({
          geometry: trisToGeometry(part.tris),
          role: part.role,
          pos: [p.x, p.y, p.z],
          rotX: p.rotX,
        });
      }
    };
    push(box, place.box);
    push(lid, place.lid);
    caps.forEach((cap, i) => push(cap, place.caps[i]));
    return out;
  }, [built, cols, rows]);

  const colourOf: Record<FidgetRole, string> = { box: boxColor, cap: capColor, text: textColor };

  if (fontError) return <Placeholder>Kunne ikke indlæse skrifttypen</Placeholder>;
  if (!pieces) return <Placeholder>Indlæser 3D-model…</Placeholder>;

  return (
    <div className="w-full aspect-[4/3] rounded-2xl bg-gray-50 overflow-hidden">
      <Canvas camera={{ position: [0, -90, 70], fov: 35, near: 0.1, far: 2000 }} dpr={[1, 2]}>
        <ambientLight intensity={0.85} />
        <directionalLight position={[40, -60, 90]} intensity={1.4} />
        <directionalLight position={[-50, 40, -30]} intensity={0.45} />
        {/* Re-key on the grid so the framing re-fits when the box changes size. */}
        <Bounds key={`${cols}x${rows}`} fit clip observe margin={1.2}>
          <group>
            {pieces.map((p, i) => (
              <mesh key={i} geometry={p.geometry} position={p.pos} rotation={[p.rotX, 0, 0]}>
                <meshStandardMaterial
                  color={colourOf[p.role]}
                  roughness={p.role === "box" ? 0.7 : 0.55}
                  metalness={0.05}
                />
              </mesh>
            ))}
          </group>
        </Bounds>
        <OrbitControls makeDefault enablePan={false} enableDamping minDistance={30} maxDistance={500} />
      </Canvas>
    </div>
  );
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-full aspect-[4/3] rounded-2xl bg-gray-50 flex items-center justify-center text-sm text-gray-400">
      {children}
    </div>
  );
}
