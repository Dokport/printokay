"use client";

/**
 * Interactive 3D preview of the configured keyring.
 *
 * Runs the SAME geometry core (`lib/keyringMesh.ts`) as the server STL generator,
 * so what the customer rotates here is exactly what gets printed. Geometry is only
 * rebuilt when text/font/shape/hole/size change; switching colors just updates the
 * material color (no geometry work) → instant.
 *
 * Must be loaded with `next/dynamic` + `ssr: false` (three.js is client-only).
 */

import { useEffect, useMemo, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Bounds } from "@react-three/drei";
import * as THREE from "three";
import { loadFont } from "@/lib/fontLoader";
import { contoursFromFont, type OpenTypeFontLike } from "@/lib/textpaths";
import { buildKeyringMesh, TOTAL_HEIGHT_MM, type Tri } from "@/lib/keyringMesh";
import { calcFontSize, type KeyringConfig, type KeyringSizeOption } from "@/lib/keyring";
import { splitTextLines } from "@/lib/textpaths";
import { KeyOnRing } from "@/components/ScaleKeyArt";



// ─── Triangle list → three.js geometry ─────────────────────────────────────────

function trisToGeometry(tris: Tri[]): THREE.BufferGeometry {
  const positions = new Float32Array(tris.length * 9);
  let o = 0;
  for (const t of tris) {
    for (const v of t) {
      positions[o++] = v[0];
      positions[o++] = v[1];
      positions[o++] = v[2];
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.computeVertexNormals();
  return g;
}

/** Bounding box (mm) of a triangle list. */
function bboxOf(tris: Tri[]) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const t of tris) for (const v of t) {
    if (v[0] < minX) minX = v[0];
    if (v[0] > maxX) maxX = v[0];
    if (v[1] < minY) minY = v[1];
    if (v[1] > maxY) maxY = v[1];
  }
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

const cm = (mm: number) => (mm / 10).toFixed(1).replace(".", ",");

/**
 * Size reference, staged like a product shot: a split ring threaded through the
 * keyring's own hole, with an ordinary house key hanging off it. Drawn as pure
 * OUTLINES so it reads as a diagram around the product rather than extra products.
 * Off by default ("Tjek størrelse").
 */
function ScaleKey({
  ring,
  hole,
}: {
  ring: ReturnType<typeof bboxOf>;
  hole: { cx: number; cy: number; r: number };
}) {
  return (
    <KeyOnRing
      hole={hole}
      centre={{ x: (ring.minX + ring.maxX) / 2, y: (ring.minY + ring.maxY) / 2 }}
      z={TOTAL_HEIGHT_MM / 2}
    />
  );
}

// ─── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  text: string;
  font: string;
  shapeType: "auto" | "heart" | "oval" | "round";
  holePosition: "top" | "side";
  size: KeyringSizeOption | null;
  fontSize: number;       // mm; <=0 → auto (matches generateKeyringStl fallback)
  baseColor: string;
  textColor: string;
};

/** Gentle 3/4 tilt: the product on its own, so the raised text and thickness read. */
const POSE_THREE_QUARTER: [number, number, number] = [-0.42, -0.38, 0];
/** Near top-down: the classic flat-lay angle for the staged size comparison. */
const POSE_FLAT: [number, number, number] = [-0.10, -0.07, -0.09];

// ─── Mesh (geometry rebuilt on shape inputs; colors update independently) ───────

function KeyringMeshes({
  base,
  text,
  baseColor,
  textColor,
  ring,
  hole,
  showScale,
}: {
  base: THREE.BufferGeometry;
  text: THREE.BufferGeometry;
  baseColor: string;
  textColor: string;
  ring: ReturnType<typeof bboxOf>;
  hole: { cx: number; cy: number; r: number };
  showScale: boolean;
}) {
  return (
    <group rotation={showScale ? POSE_FLAT : POSE_THREE_QUARTER}>
      <mesh geometry={base}>
        <meshStandardMaterial color={baseColor} roughness={0.65} metalness={0.05} />
      </mesh>
      <mesh geometry={text}>
        <meshStandardMaterial color={textColor} roughness={0.55} metalness={0.05} />
      </mesh>
      {showScale && <ScaleKey ring={ring} hole={hole} />}
    </group>
  );
}

export default function KeyringPreview3D({
  text,
  font,
  shapeType,
  holePosition,
  size,
  fontSize,
  baseColor,
  textColor,
}: Props) {
  const [fontObj, setFontObj] = useState<OpenTypeFontLike | null>(null);
  const [fontError, setFontError] = useState(false);
  // The size-reference key is opt-in, so the product is what you see by default.
  const [showScale, setShowScale] = useState(false);

  // Load font (async, cached) whenever the font id changes.
  useEffect(() => {
    let alive = true;
    setFontError(false);
    loadFont(font)
      .then((f) => { if (alive) setFontObj(f); })
      .catch(() => { if (alive) setFontError(true); });
    return () => { alive = false; };
  }, [font]);

  // Build geometry only when shape-affecting inputs change.
  const geom = useMemo(() => {
    if (!fontObj || !size || !text.trim()) return null;
    try {
      const fs = fontSize > 0 ? fontSize : calcFontSize(text, font, size) ?? 20;
      const contours = contoursFromFont(fontObj, text, fs);
      const config = { text, font, shapeType, holePosition, sizeId: size.id } as KeyringConfig;
      const { base, text: textTris, hole } = buildKeyringMesh(contours, config, size);
      if (!base.length && !textTris.length) return null;
      return {
        base: trisToGeometry(base),
        text: trisToGeometry(textTris),
        // Real millimetre dimensions, for the read-out and the size reference.
        ring: bboxOf([...base, ...textTris]),
        letters: textTris.length ? bboxOf(textTris) : null,
        hole,
      };
    } catch {
      return null;
    }
    // size.id covers size identity; geometry depends on its mm dimensions via id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontObj, text, font, shapeType, holePosition, fontSize, size?.id]);

  // Dispose previous geometries when they change / on unmount (avoid GPU leaks).
  useEffect(() => {
    return () => {
      if (geom) { geom.base.dispose(); geom.text.dispose(); }
    };
  }, [geom]);

  // Height follows the viewport (clamped), so short viewports — mobile landscape,
  // zoomed-in desktops — get a smaller canvas instead of one that eats the screen.
  const wrap = "w-full h-[clamp(150px,28vh,300px)] rounded-2xl bg-gray-50 border border-gray-100 overflow-hidden";
  const placeholder = (msg: string) => (
    <div className={`${wrap} flex items-center justify-center text-sm text-gray-400`}>
      {msg}
    </div>
  );

  if (!size) return placeholder("Vælg en størrelse");
  if (fontError) return placeholder("Kunne ikke indlæse skrifttypen");
  if (!text.trim()) return placeholder("Skriv din tekst for at se 3D-model");
  if (!geom) return placeholder("Indlæser 3D-model…");

  return (
    <div className="flex flex-col gap-1.5">
    <div className={wrap}>
      <Canvas
        camera={{ position: [0, 22, 70], fov: 35, near: 0.1, far: 2000 }}
        dpr={[1, 2]}
      >
        <ambientLight intensity={0.85} />
        <directionalLight position={[40, 60, 80]} intensity={1.5} />
        <directionalLight position={[-50, -20, -40]} intensity={0.5} />
        {/* Re-key on the toggle so the framing re-fits when the key appears/disappears. */}
        <Bounds key={showScale ? "scale" : "plain"} fit clip observe margin={1.25}>
          <KeyringMeshes base={geom.base} text={geom.text} baseColor={baseColor} textColor={textColor}
                         ring={geom.ring} hole={geom.hole} showScale={showScale} />
        </Bounds>
        <OrbitControls
          makeDefault
          enablePan={false}
          enableDamping
          minDistance={20}
          maxDistance={400}
        />
      </Canvas>
    </div>

    {/* Live size read-out + the opt-in real-world comparison. */}
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs text-gray-500">
      <span>Længde <strong className="text-gray-700">{cm(geom.ring.w)} cm</strong></span>
      {geom.letters && (
        // With two lines the measured block covers both, so divide it down to what
        // the customer actually reads: the height of one line's lettering.
        <span>
          Teksthøjde{" "}
          <strong className="text-gray-700">
            {cm(geom.letters.h / Math.max(1, splitTextLines(text).length))} cm
          </strong>
          {splitTextLines(text).length > 1 && <span className="text-gray-400"> pr. linje</span>}
        </span>
      )}
      <button
        type="button"
        onClick={() => setShowScale((v) => !v)}
        aria-pressed={showScale}
        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-medium transition-colors ${
          showScale
            ? "border-gray-300 bg-gray-100 text-gray-700"
            : "border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700"
        }`}
      >
        🔑 Tjek størrelse
      </button>
    </div>
    {showScale && (
      <p className="text-center text-[11px] text-gray-400">
        Nøglen er en helt almindelig husnøgle — vist i rigtig størrelse til sammenligning
      </p>
    )}
    </div>
  );
}
