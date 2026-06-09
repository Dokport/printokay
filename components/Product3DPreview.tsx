"use client";

/**
 * Interactive 3D preview of a product, coloured with the customer's chosen
 * filament per colour zone.
 *
 * Geometry (mesh + paint_color zones) is fetched once from
 * `/api/products/[id]/mesh` and built into one BufferGeometry per zone. Changing
 * a colour only updates the material → instant, no geometry rebuild.
 *
 * Must be loaded with `next/dynamic` + `ssr:false` (three.js is client-only).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Bounds } from "@react-three/drei";
import * as THREE from "three";

type Zone = { key: string; indices: number[] };
type Mesh = { positions: number[]; zones: Zone[] };

type Props = {
  productId: string;
  zoneColors: Record<string, string>; // zone-key → hex
  highlightZone?: string | null;      // admin: emphasise one zone, dim the rest
  version?: string;                   // bump to refetch after a model change
  className?: string;
};

// Fetch + cache the parsed mesh once per (product, version).
const meshCache = new Map<string, Promise<Mesh>>();
function loadMesh(productId: string, version?: string): Promise<Mesh> {
  const k = `${productId}:${version ?? ""}`;
  let p = meshCache.get(k);
  if (!p) {
    p = fetch(`/api/products/${productId}/mesh${version ? `?v=${encodeURIComponent(version)}` : ""}`)
      .then((r) => {
        if (!r.ok) throw new Error(`mesh ${r.status}`);
        return r.json();
      });
    meshCache.set(k, p);
  }
  return p;
}

const DIM = "#e5e7eb";
const HILITE = "#f97316";
const UNSET = "#cbd5e1";

function ZoneMeshes({
  geometries,
  zoneColors,
  highlightZone,
}: {
  geometries: { key: string; geo: THREE.BufferGeometry }[];
  zoneColors: Record<string, string>;
  highlightZone?: string | null;
}) {
  return (
    // Bambu models are Z-up; stand the model up for a natural view.
    <group rotation={[-Math.PI / 2, 0, 0]}>
      {geometries.map(({ key, geo }) => {
        const color = highlightZone
          ? key === highlightZone
            ? HILITE
            : DIM
          : zoneColors[key] || UNSET;
        return (
          <mesh key={key} geometry={geo}>
            <meshStandardMaterial color={color} roughness={0.6} metalness={0.05} />
          </mesh>
        );
      })}
    </group>
  );
}

export default function Product3DPreview({
  productId,
  zoneColors,
  highlightZone,
  version,
  className,
}: Props) {
  const [mesh, setMesh] = useState<Mesh | null>(null);
  const [error, setError] = useState(false);
  const builtRef = useRef<{ key: string; geo: THREE.BufferGeometry }[] | null>(null);

  useEffect(() => {
    let alive = true;
    setError(false);
    setMesh(null);
    loadMesh(productId, version)
      .then((m) => { if (alive) setMesh(m); })
      .catch(() => { if (alive) setError(true); });
    return () => { alive = false; };
  }, [productId, version]);

  // Build one indexed geometry per zone (shared position buffer).
  const geometries = useMemo(() => {
    if (!mesh) return null;
    const positions = new Float32Array(mesh.positions);
    const out = mesh.zones.map(({ key, indices }) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      g.setIndex(indices);
      g.computeVertexNormals();
      return { key, geo: g };
    });
    builtRef.current = out;
    return out;
  }, [mesh]);

  // Dispose GPU buffers when geometry changes / unmounts.
  useEffect(() => {
    return () => { builtRef.current?.forEach(({ geo }) => geo.dispose()); };
  }, [geometries]);

  const wrap = className ?? "w-full h-[240px] rounded-2xl bg-gray-50 border border-gray-100 overflow-hidden";
  const placeholder = (msg: string) => (
    <div className={`${wrap} flex items-center justify-center text-sm text-gray-400`}>{msg}</div>
  );

  if (error) return placeholder("Kunne ikke indlæse 3D-model");
  if (!geometries) return placeholder("Indlæser 3D-model…");

  return (
    <div className={wrap}>
      <Canvas camera={{ position: [0, 30, 90], fov: 35, near: 0.1, far: 3000 }} dpr={[1, 2]}>
        <ambientLight intensity={0.85} />
        <directionalLight position={[40, 80, 60]} intensity={1.4} />
        <directionalLight position={[-50, -20, -40]} intensity={0.5} />
        <Bounds fit clip observe margin={1.2}>
          <ZoneMeshes geometries={geometries} zoneColors={zoneColors} highlightZone={highlightZone} />
        </Bounds>
        <OrbitControls makeDefault enablePan={false} enableDamping minDistance={10} maxDistance={600} />
      </Canvas>
    </div>
  );
}
