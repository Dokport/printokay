"use client";

/**
 * The size reference shared by every preview: an ordinary house key, at true size.
 *
 * Drawn as pure OUTLINES on a flat fill — no thickness, no shading — so it reads as
 * a diagram placed next to the product rather than as a second product. Kept in one
 * place because the whole point is that a key looks identical everywhere it appears;
 * two copies would drift and quietly stop being the same reference.
 */

import { useEffect, useMemo } from "react";
import { Line } from "@react-three/drei";
import * as THREE from "three";

// Profile of a Ruko 500-series house key, at true size: 24mm bow, ~58mm overall.
export const KEY_BOW_R = 12;     // bow radius (mm)
export const KEY_HOLE_R = 3.6;
export const KEY_HOLE_X = -4.5;  // hole sits above centre, away from the blade
export const KEY_HALF_H = 4.2;   // blade half-height
export const KEY_TIP_X = 46;

/** How far the drawing reaches along its own +X, bow rim to blade tip. */
export const KEY_LENGTH_MM = KEY_TIP_X + KEY_BOW_R;
/**
 * Where the drawing's midpoint falls in <KeyArt>'s parent frame. The key is
 * anchored by its bow HOLE, not its middle, so laying it out centred under
 * something means subtracting this rather than half the length.
 */
export const KEY_CENTRE_X = (KEY_TIP_X - KEY_BOW_R) / 2 - KEY_HOLE_X;

/** Line art sits on an opaque fill, so nothing shows through between the strokes. */
export const FILL_COLOR = "#f7f9fb";
export const STROKE_COLOR = "#8b98a9";

// A chunky 30mm split ring, drawn as its two wire edges.
export const SPLIT_RING_R = 15;
export const SPLIT_RING_WIRE = 2;

/** Outer contour of the key, traced along +X from the bow. */
export function keyOutline(): THREE.Vector3[] {
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
export function keyHoleOutline(): THREE.Vector3[] {
  const p: THREE.Vector3[] = [];
  for (let i = 0; i <= 48; i++) {
    const t = (i / 48) * Math.PI * 2;
    p.push(new THREE.Vector3(KEY_HOLE_X + Math.cos(t) * KEY_HOLE_R, Math.sin(t) * KEY_HOLE_R, 0));
  }
  return p;
}

export function circleOutline(r: number, steps = 64): THREE.Vector3[] {
  const p: THREE.Vector3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    p.push(new THREE.Vector3(Math.cos(t) * r, Math.sin(t) * r, 0));
  }
  return p;
}

/** Filled annulus matching the split-ring outlines. */
export function ringFillShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.absarc(0, 0, SPLIT_RING_R, 0, Math.PI * 2, false);
  const h = new THREE.Path();
  h.absarc(0, 0, SPLIT_RING_R - SPLIT_RING_WIRE, 0, Math.PI * 2, true);
  s.holes.push(h);
  return s;
}

/** Filled key body matching the key outlines (bow hole punched out). */
export function keyFillShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.setFromPoints(keyOutline().map((v) => new THREE.Vector2(v.x, v.y)));
  const h = new THREE.Path();
  h.absarc(KEY_HOLE_X, 0, KEY_HOLE_R, 0, Math.PI * 2, true);
  s.holes.push(h);
  return s;
}

/**
 * The key itself, drawn with its BOW HOLE at the local origin so it can either be
 * threaded onto a ring or laid down beside something. Blade points along +X.
 */
export function KeyArt() {
  const body = useMemo(() => keyOutline(), []);
  const hole = useMemo(() => keyHoleOutline(), []);
  const fill = useMemo(() => new THREE.ShapeGeometry(keyFillShape()), []);
  useEffect(() => () => fill.dispose(), [fill]);

  return (
    <group position={[-KEY_HOLE_X, 0, 0]}>
      <mesh geometry={fill} position={[0, 0, -0.05]}>
        <meshBasicMaterial color={FILL_COLOR} side={THREE.DoubleSide} />
      </mesh>
      <Line points={body} color={STROKE_COLOR} lineWidth={1.6} />
      <Line points={hole} color={STROKE_COLOR} lineWidth={1.6} />
    </group>
  );
}

/** The split ring, centred on the local origin, lying in the local XY plane. */
export function SplitRingArt() {
  const outer = useMemo(() => circleOutline(SPLIT_RING_R), []);
  const inner = useMemo(() => circleOutline(SPLIT_RING_R - SPLIT_RING_WIRE), []);
  const fill = useMemo(() => new THREE.ShapeGeometry(ringFillShape()), []);
  useEffect(() => () => fill.dispose(), [fill]);

  return (
    <>
      <mesh geometry={fill} position={[0, 0, -0.05]}>
        <meshBasicMaterial color={FILL_COLOR} side={THREE.DoubleSide} />
      </mesh>
      <Line points={outer} color={STROKE_COLOR} lineWidth={1.6} />
      <Line points={inner} color={STROKE_COLOR} lineWidth={1.6} />
    </>
  );
}

/**
 * The whole staged arrangement: a split ring threaded through a product's hole,
 * with the key hanging off it.
 *
 * `hole` is the hole to thread, `centre` the middle of the body it belongs to — the
 * chain falls away from the body, so the staging stays sensible whether the hole is
 * on the top, the side, or on a lug of its own. `z` is the height the wire runs at;
 * put it at mid-thickness so the wire passes THROUGH the hole, dipping behind on one
 * side and rising in front on the other, rather than resting on top of the material.
 */
export function KeyOnRing({
  hole,
  centre,
  z,
}: {
  hole: { cx: number; cy: number; r: number };
  centre: { x: number; y: number };
  z: number;
}) {
  const dx = hole.cx - centre.x, dy = hole.cy - centre.y;
  const len = Math.hypot(dx, dy) || 1;
  const angle = Math.atan2(dy / len, dx / len);

  // Thread both holes onto the WIRE'S CENTRELINE, not its inner edge — otherwise the
  // ring runs through the surrounding material instead of through the hole.
  const WIRE_MID = SPLIT_RING_R - SPLIT_RING_WIRE / 2;

  // Tilting the ring only leaves the two points ON the tilt axis in the original
  // plane, so the product's hole and the key's hole must be diametrically opposite
  // and the axis must run through both. They need NOT line up with the product
  // though: let the whole ring-and-key chain fall away at an angle, and the key keeps
  // its relaxed pose while both holes stay exactly on the wire.
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

  return (
    <group>
      <group position={[rx, ry, z]} quaternion={ringQuat}>
        <SplitRingArt />
      </group>
      <group position={[kx, ky, z]} rotation={[0, 0, keyAngle]}>
        <KeyArt />
      </group>
    </group>
  );
}
