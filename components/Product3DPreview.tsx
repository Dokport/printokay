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

import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Bounds } from "@react-three/drei";
import * as THREE from "three";
import { decodeMeshBinary, type BinaryMesh } from "@/lib/meshBinary";

type Mesh = BinaryMesh;

type Props = {
  productId: string;
  zoneColors: Record<string, string>; // zone-key → hex
  highlightZone?: string | null;      // admin: emphasise one zone, dim the rest
  version?: string;                   // bump to refetch after a model change
  className?: string;
  /** Called when the mesh can't load or WebGL rendering crashes — lets the parent
   *  fall back to the prerendered product photo instead of a dead panel. */
  onError?: () => void;
};

// Fetch + cache the parsed mesh once per (product, version). Binary format: the
// response bytes ARE the typed arrays three.js consumes — no JSON.parse of MBs.
const meshCache = new Map<string, Promise<Mesh>>();
function loadMesh(productId: string, version?: string): Promise<Mesh> {
  const k = `${productId}:${version ?? ""}`;
  let p = meshCache.get(k);
  if (!p) {
    p = fetch(`/api/products/${productId}/mesh?f=bin${version ? `&v=${encodeURIComponent(version)}` : ""}`)
      .then((r) => {
        if (!r.ok) throw new Error(`mesh ${r.status}`);
        return r.arrayBuffer();
      })
      .then(decodeMeshBinary);
    // Don't cache failures — a retry (e.g. after a flaky connection) should refetch.
    p.catch(() => meshCache.delete(k));
    meshCache.set(k, p);
  }
  return p;
}

// Rendering crashes (WebGL context failures on old GPUs, driver quirks) surface as
// render-phase throws that would otherwise take down the whole page section.
class CanvasErrorBoundary extends Component<
  { fallback: ReactNode; onError?: () => void; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError?.();
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

const DIM = "#e5e7eb";
const HILITE = "#f97316";
const UNSET = "#cbd5e1";

// One combined geometry: shared positions, normals computed across ALL triangles
// (so shading is smooth across zone boundaries — no seams), with one material
// group per colour zone.
function buildGeometry(mesh: Mesh): { geometry: THREE.BufferGeometry; keys: string[] } {
  const geometry = new THREE.BufferGeometry();
  // The decoded positions are already a Float32Array view over the response bytes.
  geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));

  const total = mesh.zones.reduce((n, z) => n + z.indices.length, 0);
  const index = new Uint32Array(total);
  const keys: string[] = [];
  let off = 0;
  for (const z of mesh.zones) {
    index.set(z.indices, off);
    geometry.addGroup(off, z.indices.length, keys.length);
    keys.push(z.key);
    off += z.indices.length;
  }
  geometry.setIndex(new THREE.BufferAttribute(index, 1));
  geometry.computeVertexNormals();
  return { geometry, keys };
}

function ZoneMeshes({
  geometry,
  keys,
  zoneColors,
  highlightZone,
}: {
  geometry: THREE.BufferGeometry;
  keys: string[];
  zoneColors: Record<string, string>;
  highlightZone?: string | null;
}) {
  return (
    // Bambu models are Z-up; stand the model up for a natural view.
    <group rotation={[-Math.PI / 2, 0, 0]}>
      <mesh geometry={geometry}>
        {keys.map((key, i) => {
          const color = highlightZone ? (key === highlightZone ? HILITE : DIM) : zoneColors[key] || UNSET;
          return (
            <meshStandardMaterial
              key={key}
              attach={`material-${i}`}
              color={color}
              roughness={0.6}
              metalness={0.05}
              side={THREE.DoubleSide}
              flatShading={false}
            />
          );
        })}
      </mesh>
    </group>
  );
}

export default function Product3DPreview({
  productId,
  zoneColors,
  highlightZone,
  version,
  className,
  onError,
}: Props) {
  const [mesh, setMesh] = useState<Mesh | null>(null);
  const [error, setError] = useState(false);
  const builtRef = useRef<THREE.BufferGeometry | null>(null);
  // Keep the latest callback out of the effect deps, so a parent passing an inline
  // arrow doesn't retrigger the fetch on every render.
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    let alive = true;
    setError(false);
    setMesh(null);
    loadMesh(productId, version)
      .then((m) => { if (alive) setMesh(m); })
      .catch(() => {
        if (alive) {
          setError(true);
          onErrorRef.current?.();
        }
      });
    return () => { alive = false; };
  }, [productId, version]);

  // One combined geometry with per-zone groups (rebuilt only when mesh changes).
  const built = useMemo(() => {
    if (!mesh) return null;
    const b = buildGeometry(mesh);
    builtRef.current = b.geometry;
    return b;
  }, [mesh]);

  // Dispose GPU buffers when geometry changes / unmounts.
  useEffect(() => {
    return () => { builtRef.current?.dispose(); };
  }, [built]);

  const wrap = className ?? "w-full h-[240px] rounded-2xl bg-gray-50 border border-gray-100 overflow-hidden";
  const placeholder = (msg: string) => (
    <div className={`${wrap} flex items-center justify-center text-sm text-gray-400`}>{msg}</div>
  );

  if (error) return placeholder("Kunne ikke indlæse 3D-model");
  if (!built) return placeholder("Indlæser 3D-model…");

  return (
    <div className={wrap}>
      <CanvasErrorBoundary fallback={placeholder("Kunne ikke vise 3D-model")} onError={onError}>
        <Canvas
          camera={{ position: [0, 30, 90], fov: 35, near: 0.1, far: 3000 }}
          dpr={[1, 2]}
          gl={{ antialias: true }}
        >
          <ambientLight intensity={0.6} />
          <hemisphereLight args={["#ffffff", "#b0b0b0", 0.9]} />
          <directionalLight position={[40, 80, 60]} intensity={1.1} />
          <directionalLight position={[-50, -20, -40]} intensity={0.35} />
          <Bounds fit clip observe margin={1.2}>
            <ZoneMeshes geometry={built.geometry} keys={built.keys} zoneColors={zoneColors} highlightZone={highlightZone} />
          </Bounds>
          <OrbitControls makeDefault enablePan={false} enableDamping minDistance={10} maxDistance={600} />
        </Canvas>
      </CanvasErrorBoundary>
    </div>
  );
}
