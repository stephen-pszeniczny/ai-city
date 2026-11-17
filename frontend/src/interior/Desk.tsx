// The robot's work desk in the building's tint: top with a glowing edge strip,
// legs, a drawer unit, a cable tray and a keyboard with separate keys.
// Centred on its own origin; top surface at y = 0.75 (matches the robot).
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import type { Detail } from "../belt/lod";

export const DESK = { width: 1.7, depth: 0.66, topY: 0.75 } as const;
/** Desk centre relative to the robot (the robot sits at the origin, facing +z). */
export const DESK_Z = 0.78;
/** Keyboard centre, desk-local (under the robot's hands). */
const KEYBOARD = new THREE.Vector3(0, DESK.topY + 0.012, 0.6 - DESK_Z);

const ROWS = 5;
const COLS = 14;

export function Desk({ tint, detail = "near" }: { tint: string; detail?: Detail }) {
  const mats = useMemo(() => {
    const t = new THREE.Color(tint);
    return {
      top: new THREE.MeshPhysicalMaterial({
        color: t.clone().multiplyScalar(0.55),
        roughness: 0.3,
        metalness: 0.2,
        clearcoat: 0.8,
        clearcoatRoughness: 0.2,
      }),
      edge: new THREE.MeshBasicMaterial({
        color: t.clone().multiplyScalar(1.6),
        toneMapped: false,
      }),
      leg: new THREE.MeshStandardMaterial({ color: 0x2b313c, roughness: 0.45, metalness: 0.8 }),
      drawer: new THREE.MeshStandardMaterial({
        color: t.clone().multiplyScalar(0.35),
        roughness: 0.5,
        metalness: 0.4,
      }),
      handle: new THREE.MeshStandardMaterial({ color: 0xc9ced8, roughness: 0.25, metalness: 0.9 }),
      kbBase: new THREE.MeshStandardMaterial({ color: 0x1b1f28, roughness: 0.4, metalness: 0.6 }),
      key: new THREE.MeshStandardMaterial({ color: 0x3d4558, roughness: 0.55, metalness: 0.2 }),
      keyGlow: new THREE.MeshBasicMaterial({
        color: t.clone().multiplyScalar(0.9),
        toneMapped: false,
      }),
    };
  }, [tint]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  const keyGeo = useMemo(() => new THREE.BoxGeometry(0.034, 0.012, 0.03), []);
  useEffect(() => () => keyGeo.dispose(), [keyGeo]);
  const keys = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = keys.current;
    if (!m) return;
    const o = new THREE.Object3D();
    let i = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        o.position.set((c - (COLS - 1) / 2) * 0.04, 0.012, (r - (ROWS - 1) / 2) * 0.036);
        o.scale.set(1, 1, 1);
        o.updateMatrix();
        m.setMatrixAt(i++, o.matrix);
      }
    }
    // Space bar.
    o.position.set(0, 0.012, ((ROWS + 1) / 2) * 0.036);
    o.scale.set(6, 1, 1);
    o.updateMatrix();
    m.setMatrixAt(i, o.matrix);
    m.instanceMatrix.needsUpdate = true;
  }, [detail]);

  const { width: W, depth: D, topY } = DESK;
  const near = detail === "near";
  return (
    <group>
      <mesh position={[0, topY - 0.02, 0]} material={mats.top} castShadow receiveShadow>
        <boxGeometry args={[W, 0.04, D]} />
      </mesh>
      {/* Glowing tint strip along the front edge (faces the robot). */}
      <mesh position={[0, topY - 0.025, -D / 2 - 0.004]} material={mats.edge}>
        <boxGeometry args={[W, 0.012, 0.008]} />
      </mesh>
      {/* Legs: two slab legs with feet. */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * (W / 2 - 0.08), 0, 0]}>
          <mesh position={[0, (topY - 0.04) / 2, 0]} material={mats.leg}>
            <boxGeometry args={[0.05, topY - 0.04, D - 0.12]} />
          </mesh>
          <mesh position={[0, 0.012, 0]} material={mats.leg}>
            <boxGeometry args={[0.09, 0.024, D]} />
          </mesh>
        </group>
      ))}
      {near && (
        <>
          {/* Drawer unit on the right, with three drawers. */}
          <group position={[W / 2 - 0.32, 0, 0.02]}>
            <mesh position={[0, 0.36, 0]} material={mats.drawer} castShadow>
              <boxGeometry args={[0.4, 0.66, D - 0.1]} />
            </mesh>
            {[0.18, 0.38, 0.58].map((y) => (
              <group key={y} position={[0, y, -(D - 0.1) / 2 - 0.005]}>
                <mesh material={mats.leg}>
                  <boxGeometry args={[0.38, 0.004, 0.01]} />
                </mesh>
                <mesh position={[0, 0.07, -0.01]} material={mats.handle}>
                  <boxGeometry args={[0.14, 0.014, 0.014]} />
                </mesh>
              </group>
            ))}
          </group>
          {/* Cable tray under the back edge. */}
          <mesh position={[0, topY - 0.1, D / 2 - 0.08]} material={mats.leg}>
            <boxGeometry args={[W - 0.3, 0.05, 0.08]} />
          </mesh>
        </>
      )}
      {/* Keyboard: base, separate keys, a thin tint backlight. */}
      <group position={KEYBOARD}>
        <mesh material={mats.kbBase} castShadow>
          <boxGeometry args={[0.62, 0.018, 0.25]} />
        </mesh>
        {near ? (
          <instancedMesh ref={keys} args={[keyGeo, mats.key, ROWS * COLS + 1]} key="keys" />
        ) : null}
        <mesh position={[0, -0.006, -0.126]} material={mats.keyGlow}>
          <boxGeometry args={[0.6, 0.004, 0.003]} />
        </mesh>
      </group>
    </group>
  );
}
