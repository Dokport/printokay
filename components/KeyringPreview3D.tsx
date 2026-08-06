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

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Bounds } from "@react-three/drei";
import * as THREE from "three";
import { parse } from "opentype.js";
import { contoursFromFont, type OpenTypeFontLike } from "@/lib/textpaths";
import { buildKeyringMesh, type Tri } from "@/lib/keyringMesh";
import { calcFontSize, type KeyringConfig, type KeyringSizeOption } from "@/lib/keyring";

// ─── Font loading (browser): fetch + parse once per font id, cached ────────────

const fontCache = new Map<string, Promise<OpenTypeFontLike>>();

function loadFont(fontId: string): Promise<OpenTypeFontLike> {
  let p = fontCache.get(fontId);
  if (!p) {
    p = fetch(`/fonts/${fontId}.ttf`)
      .then((r) => {
        if (!r.ok) throw new Error(`Kunne ikke hente font: ${fontId}`);
        return r.arrayBuffer();
      })
      .then((buf) => parse(buf) as unknown as OpenTypeFontLike);
    fontCache.set(fontId, p);
  }
  return p;
}

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

// ─── Scale reference: an ordinary house key ────────────────────────────────────

// Sized like a typical house key: 22mm bow across, ~56mm overall.
const KEY_BOW_R = 11;     // bow outer radius (mm)
const KEY_HOLE_R = 4.5;
const KEY_SHANK_H = 3.2;  // half-height of the shank
const KEY_BLADE_LEN = 34;
const KEY_THICK = 1.6;    // deliberately thin — a flat cut-out, not a solid prop

/**
 * The whole key as ONE flat silhouette (bow + blade, with the bow's hole), so it can
 * be extruded as a single cut-out shape and shaded flat.
 */
function keyShape(): THREE.Shape {
  const jx = Math.sqrt(KEY_BOW_R * KEY_BOW_R - KEY_SHANK_H * KEY_SHANK_H); // bow/blade junction
  const a = Math.atan2(KEY_SHANK_H, jx);
  const tip = jx + KEY_BLADE_LEN;
  const low = -KEY_SHANK_H - 1.6; // blade is a little deeper than the shank

  const s = new THREE.Shape();
  s.moveTo(jx, -KEY_SHANK_H);
  s.absarc(0, 0, KEY_BOW_R, -a, a, true); // the long way round the bow
  s.lineTo(tip - 3, KEY_SHANK_H);         // blade back
  s.lineTo(tip, KEY_SHANK_H - 2);         // tapered tip
  s.lineTo(tip, low);
  // teeth, cut back along the underside towards the bow
  s.lineTo(tip - 4, low);
  s.lineTo(tip - 6.5, low + 3);
  s.lineTo(tip - 9, low);
  s.lineTo(tip - 12, low + 3);
  s.lineTo(tip - 15, low);
  s.lineTo(tip - 18, low + 2.4);
  s.lineTo(tip - 21, low);
  s.lineTo(jx + 6, low);
  s.lineTo(jx + 6, -KEY_SHANK_H);
  s.closePath();

  const hole = new THREE.Path();
  hole.absarc(0, 0, KEY_HOLE_R, 0, Math.PI * 2, true);
  s.holes.push(hole);
  return s;
}

/**
 * Size reference: an ordinary house key at its true size, drawn as a flat vector-style
 * cut-out — unlit fill plus a darker edge for the thickness. The deliberately
 * illustrative look keeps it from reading as part of the product; it's a ruler you
 * already own. Off by default, toggled with "Tjek størrelse".
 */
function ScaleKey({ ring }: { ring: ReturnType<typeof bboxOf> }) {
  const geom = useMemo(() => {
    const g = new THREE.ExtrudeGeometry(keyShape(), { depth: KEY_THICK, bevelEnabled: false });
    g.translate(0, 0, -KEY_THICK / 2);
    return g;
  }, []);
  useEffect(() => () => geom.dispose(), [geom]);

  // Stand it upright (blade pointing up), just left of the keyring, vertically centred.
  const x = ring.minX - 9 - KEY_BOW_R;
  const y = (ring.minY + ring.maxY) / 2;

  return (
    <group position={[x, y, 0]} rotation={[0, 0, Math.PI / 2]}>
      <mesh geometry={geom}>
        {/* Unlit flat fill (caps) + darker sides → a paper/vector cut-out */}
        <meshBasicMaterial attach="material-0" color="#b6c2d1" />
        <meshBasicMaterial attach="material-1" color="#7d8da0" />
      </mesh>
    </group>
  );
}

// ─── Props ─────────────────────────────────────────────────────────────────────

type Props = {
  text: string;
  font: string;
  shapeType: "auto" | "heart" | "oval";
  holePosition: "top" | "side";
  size: KeyringSizeOption | null;
  fontSize: number;       // mm; <=0 → auto (matches generateKeyringStl fallback)
  baseColor: string;
  textColor: string;
};

// ─── Mesh (geometry rebuilt on shape inputs; colors update independently) ───────

function KeyringMeshes({
  base,
  text,
  baseColor,
  textColor,
  ring,
  showScale,
}: {
  base: THREE.BufferGeometry;
  text: THREE.BufferGeometry;
  baseColor: string;
  textColor: string;
  ring: ReturnType<typeof bboxOf>;
  showScale: boolean;
}) {
  return (
    // Face the camera with a gentle 3/4 tilt so the raised text + thickness read,
    // while the keyring shape stays clearly legible.
    <group rotation={[-0.42, -0.38, 0]}>
      <mesh geometry={base}>
        <meshStandardMaterial color={baseColor} roughness={0.65} metalness={0.05} />
      </mesh>
      <mesh geometry={text}>
        <meshStandardMaterial color={textColor} roughness={0.55} metalness={0.05} />
      </mesh>
      {showScale && <ScaleKey ring={ring} />}
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
      const { base, text: textTris } = buildKeyringMesh(contours, config, size);
      if (!base.length && !textTris.length) return null;
      return {
        base: trisToGeometry(base),
        text: trisToGeometry(textTris),
        // Real millimetre dimensions, for the measuring stick.
        ring: bboxOf([...base, ...textTris]),
        letters: textTris.length ? bboxOf(textTris) : null,
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

  const wrap = "w-full h-[180px] sm:h-[280px] rounded-2xl bg-gray-50 border border-gray-100 overflow-hidden";
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
                         ring={geom.ring} showScale={showScale} />
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
        <span>Teksthøjde <strong className="text-gray-700">{cm(geom.letters.h)} cm</strong></span>
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
