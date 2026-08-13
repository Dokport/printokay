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
import { OrbitControls, Bounds, Line } from "@react-three/drei";
import * as THREE from "three";
import { parse } from "opentype.js";
import { contoursFromFont, type OpenTypeFontLike } from "@/lib/textpaths";
import { buildKeyringMesh, TOTAL_HEIGHT_MM, type Tri } from "@/lib/keyringMesh";
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

// Profile of a Ruko 500-series house key, at true size: 24mm bow, ~58mm overall.
const KEY_BOW_R = 12;     // bow radius (mm)
const KEY_HOLE_R = 3.6;
const KEY_HOLE_X = -4.5;  // hole sits above centre, away from the blade
const KEY_HALF_H = 4.2;   // blade half-height
const KEY_TIP_X = 46;

/** Outer contour of the key, traced along +X from the bow. */
function keyOutline(): THREE.Vector3[] {
  const jx = Math.sqrt(KEY_BOW_R * KEY_BOW_R - KEY_HALF_H * KEY_HALF_H); // bow/blade junction
  const a = Math.atan2(KEY_HALF_H, jx);
  const p: THREE.Vector3[] = [];
  const at = (x: number, y: number) => p.push(new THREE.Vector3(x, y, 0));

  // Bow: the long way round, from the toothed side to the spine side.
  const steps = 72;
  for (let i = 0; i <= steps; i++) {
    const t = -a - (i / steps) * (2 * Math.PI - 2 * a); // clockwise, the long way
    at(Math.cos(t) * KEY_BOW_R, Math.sin(t) * KEY_BOW_R);
  }
  // Straight spine out to the tip, then the angled tip.
  at(KEY_TIP_X - 3.5, KEY_HALF_H);
  at(KEY_TIP_X, KEY_HALF_H - 3.2);
  at(KEY_TIP_X, -KEY_HALF_H);
  // Bitting: V-cuts back along the underside towards the bow.
  const cuts: [number, number][] = [
    [3, 0], [5.5, 2.6], [8, 0], [10.5, 3.0], [13, 0],
    [15.5, 2.2], [18, 0], [20.5, 2.8], [23, 0],
  ];
  for (const [back, up] of cuts) at(KEY_TIP_X - back, -KEY_HALF_H + up);
  at(jx, -KEY_HALF_H);
  return p;
}

/** The bow's hole, as its own closed loop. */
function keyHoleOutline(): THREE.Vector3[] {
  const p: THREE.Vector3[] = [];
  for (let i = 0; i <= 48; i++) {
    const t = (i / 48) * Math.PI * 2;
    p.push(new THREE.Vector3(KEY_HOLE_X + Math.cos(t) * KEY_HOLE_R, Math.sin(t) * KEY_HOLE_R, 0));
  }
  return p;
}

// A chunky 30mm split ring, drawn as its two wire edges.
const SPLIT_RING_R = 15;
const SPLIT_RING_WIRE = 2;
/** Line art sits on an opaque fill, so nothing shows through between the strokes. */
const FILL_COLOR = "#f7f9fb";

function circleOutline(r: number, steps = 64): THREE.Vector3[] {
  const p: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    p.push(new THREE.Vector3(Math.cos(t) * r, Math.sin(t) * r, 0));
  }
  return p;
}

/** Filled annulus matching the split-ring outlines. */
function ringFillShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.absarc(0, 0, SPLIT_RING_R, 0, Math.PI * 2, false);
  const h = new THREE.Path();
  h.absarc(0, 0, SPLIT_RING_R - SPLIT_RING_WIRE, 0, Math.PI * 2, true);
  s.holes.push(h);
  return s;
}

/** Filled key body matching the key outlines (bow hole punched out). */
function keyFillShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.setFromPoints(keyOutline().map((v) => new THREE.Vector2(v.x, v.y)));
  const h = new THREE.Path();
  h.absarc(KEY_HOLE_X, 0, KEY_HOLE_R, 0, Math.PI * 2, true);
  s.holes.push(h);
  return s;
}

/**
 * Size reference, staged like a product shot: a split ring threaded through the
 * keyring's own hole, with an ordinary house key hanging off it. Both are drawn as
 * pure OUTLINES — no thickness, no fill, no shading — so they read as a diagram
 * around the product rather than as extra products. Off by default ("Tjek størrelse").
 */
function ScaleKey({
  ring,
  hole,
}: {
  ring: ReturnType<typeof bboxOf>;
  hole: { cx: number; cy: number; r: number };
}) {
  const keyBody = useMemo(() => keyOutline(), []);
  const keyHole = useMemo(() => keyHoleOutline(), []);
  const ringOuter = useMemo(() => circleOutline(SPLIT_RING_R), []);
  const ringInner = useMemo(() => circleOutline(SPLIT_RING_R - SPLIT_RING_WIRE), []);
  const ringFill = useMemo(() => new THREE.ShapeGeometry(ringFillShape()), []);
  const keyFill = useMemo(() => new THREE.ShapeGeometry(keyFillShape()), []);
  useEffect(() => () => { ringFill.dispose(); keyFill.dispose(); }, [ringFill, keyFill]);
  const stroke = "#8b98a9";

  // Everything hangs off the plate's hole, in the direction pointing away from the
  // plate — so the arrangement stays sensible whether the hole is on top or the side.
  const cx = (ring.minX + ring.maxX) / 2;
  const cy = (ring.minY + ring.maxY) / 2;
  const dx = hole.cx - cx, dy = hole.cy - cy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const angle = Math.atan2(uy, ux);

  // Thread both holes onto the WIRE'S CENTRELINE, not its inner edge — otherwise the
  // ring runs through the surrounding metal instead of through the hole.
  const WIRE_MID = SPLIT_RING_R - SPLIT_RING_WIRE / 2;

  // Tilting the ring only leaves the two points ON the tilt axis in the original
  // plane, so the plate's hole and the key's hole must be diametrically opposite and
  // the axis must run through both. They need NOT line up with the plate though: let
  // the whole ring-and-key chain fall away at an angle, and the key keeps its relaxed
  // pose while both holes stay exactly on the wire.
  const SPLAY = 0.42;
  const keyAngle = angle + SPLAY;
  const kux = Math.cos(keyAngle), kuy = Math.sin(keyAngle);
  const rx = hole.cx + kux * WIRE_MID;      // ring centre, one wire-radius along the chain
  const ry = hole.cy + kuy * WIRE_MID;
  const kx = hole.cx + kux * 2 * WIRE_MID;  // far point of the wire == the key's hole
  const ky = hole.cy + kuy * 2 * WIRE_MID;

  // Tilt the ring 45° about the chain axis. Points on that axis keep their height, so
  // both holes still meet the wire exactly, while the ring reads as standing up out of
  // the hole instead of lying flat like a drawn circle.
  const ringQuat = useMemo(
    () => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(kux, kuy, 0).normalize(), Math.PI / 4),
    [kux, kuy]
  );

  // Sit the hardware at mid-plate height: the wire then runs THROUGH the tag's hole —
  // dipping behind the plate on one side and rising in front on the other — rather
  // than resting on top of it and cutting across the metal.
  const z = TOTAL_HEIGHT_MM / 2;

  return (
    <group>
      {/* Split ring — opaque annulus under its two wire edges */}
      <group position={[rx, ry, z]} quaternion={ringQuat}>
        <mesh geometry={ringFill} position={[0, 0, -0.05]}>
          <meshBasicMaterial color={FILL_COLOR} side={THREE.DoubleSide} />
        </mesh>
        <Line points={ringOuter} color={stroke} lineWidth={1.6} />
        <Line points={ringInner} color={stroke} lineWidth={1.6} />
      </group>
      {/* Key, threaded on the ring by its bow hole and pointing outwards */}
      <group position={[kx, ky, z]} rotation={[0, 0, keyAngle]}>
        <group position={[-KEY_HOLE_X, 0, 0]}>
          <mesh geometry={keyFill} position={[0, 0, -0.05]}>
            <meshBasicMaterial color={FILL_COLOR} side={THREE.DoubleSide} />
          </mesh>
          <Line points={keyBody} color={stroke} lineWidth={1.6} />
          <Line points={keyHole} color={stroke} lineWidth={1.6} />
        </group>
      </group>
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
