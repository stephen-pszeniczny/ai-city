// A simple work desk in the building's tint: top, four legs and a keyboard,
// with knee space for the robot. Top surface at y = 0.75 (matches the robot).
import { useEffect, useMemo } from "react";
import * as THREE from "three";

export const DESK = { width: 1.5, depth: 0.62, topY: 0.75 } as const;

export function Desk({ tint }: { tint: string }) {
  const mats = useMemo(() => {
    const t = new THREE.Color(tint);
    return {
      top: new THREE.MeshStandardMaterial({
        color: t.clone().multiplyScalar(0.75),
        roughness: 0.45,
        metalness: 0.35,
      }),
      edge: new THREE.MeshStandardMaterial({ color: t, roughness: 0.35, metalness: 0.5 }),
      leg: new THREE.MeshStandardMaterial({ color: 0x2b313c, roughness: 0.5, metalness: 0.7 }),
      key: new THREE.MeshStandardMaterial({ color: 0x3d4558, roughness: 0.6, metalness: 0.3 }),
    };
  }, [tint]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  const { width: W, depth: D, topY } = DESK;
  return (
    <group>
      <mesh position={[0, topY - 0.02, 0]} material={mats.top} castShadow receiveShadow>
        <boxGeometry args={[W, 0.04, D]} />
      </mesh>
      <mesh position={[0, topY - 0.02, -D / 2]} material={mats.edge}>
        <boxGeometry args={[W + 0.02, 0.05, 0.02]} />
      </mesh>
      {[-1, 1].map((sx) =>
        [-1, 1].map((sz) => (
          <mesh
            key={`${sx}${sz}`}
            position={[sx * (W / 2 - 0.06), (topY - 0.04) / 2, sz * (D / 2 - 0.06)]}
            material={mats.leg}
          >
            <cylinderGeometry args={[0.03, 0.035, topY - 0.04, 10]} />
          </mesh>
        )),
      )}
      {/* Keyboard under the robot's hands, near the front edge. */}
      <mesh position={[0, topY + 0.012, -D / 2 + 0.2]} material={mats.key}>
        <boxGeometry args={[0.6, 0.02, 0.18]} />
      </mesh>
    </group>
  );
}
