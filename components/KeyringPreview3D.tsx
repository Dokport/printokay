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

/**
 * A measuring stick beside the keyring: alternating 1 cm bands along the bottom and a
 * bracket marking the letter height. It lives in the same millimetre space as the
 * model, so it scales with it — a bigger keyring simply spans more centimetre bands,
 * which is what makes the three sizes visibly different. (The cm figures themselves
 * are rendered as HTML under the canvas: crisper at this size, and it keeps the
 * asynchronously-loaded 3D text out of the auto-framing.)
 */
function Ruler({
  ring,
  letters,
}: {
  ring: ReturnType<typeof bboxOf>;
  letters: ReturnType<typeof bboxOf> | null;
}) {
  const bands = Math.max(1, Math.ceil(ring.w / 10));
  const y = ring.minY - 6; // sits just below the keyring
  const tick = "#94a3b8";

  return (
    <group>
      {Array.from({ length: bands }, (_, i) => {
        const w = Math.min(10, ring.w - i * 10);
        if (w <= 0.01) return null;
        return (
          <mesh key={`b${i}`} position={[ring.minX + i * 10 + w / 2, y, 0]}>
            <boxGeometry args={[w, 2, 0.6]} />
            <meshStandardMaterial color={i % 2 ? "#e2e8f0" : "#94a3b8"} roughness={0.95} />
          </mesh>
        );
      })}

      {/* Letter-height bracket, aligned to the actual lettering */}
      {letters && (
        <group>
          <mesh position={[ring.minX - 5, (letters.minY + letters.maxY) / 2, 0]}>
            <boxGeometry args={[1, letters.h, 0.6]} />
            <meshStandardMaterial color={tick} roughness={0.95} />
          </mesh>
          {[letters.minY, letters.maxY].map((ly, i) => (
            <mesh key={i} position={[ring.minX - 3.5, ly, 0]}>
              <boxGeometry args={[4, 1, 0.6]} />
              <meshStandardMaterial color={tick} roughness={0.95} />
            </mesh>
          ))}
        </group>
      )}
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
  letters,
}: {
  base: THREE.BufferGeometry;
  text: THREE.BufferGeometry;
  baseColor: string;
  textColor: string;
  ring: ReturnType<typeof bboxOf>;
  letters: ReturnType<typeof bboxOf> | null;
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
      <Ruler ring={ring} letters={letters} />
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
        <Bounds fit clip observe margin={1.25}>
          <KeyringMeshes base={geom.base} text={geom.text} baseColor={baseColor} textColor={textColor}
                         ring={geom.ring} letters={geom.letters} />
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

    {/* Live size read-out — each band on the ruler above is 1 cm. */}
    <div className="flex items-center justify-center gap-4 text-xs text-gray-500">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-flex h-2 w-8 overflow-hidden rounded-sm border border-gray-200">
          <span className="h-full flex-1 bg-gray-400" />
          <span className="h-full flex-1 bg-gray-200" />
          <span className="h-full flex-1 bg-gray-400" />
        </span>
        Længde <strong className="text-gray-700">{cm(geom.ring.w)} cm</strong>
      </span>
      {geom.letters && (
        <span>
          Bogstaver <strong className="text-gray-700">{cm(geom.letters.h)} cm</strong>
        </span>
      )}
    </div>
    </div>
  );
}
