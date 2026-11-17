// The Vault's round door, set in the vault room's inner wall at the end of the
// hallway, and the robot's waiting seat beside it. Closed until the first visit
// of the app session; then the robot cracks the wheel, the bolts slide back and
// it swings open into the vault (timeline in vaultGreeting.ts), and stays open
// until the app is reloaded. Station coordinates; the door faces -x
// (toward the hub).
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { DOOR_OPEN_ANGLE, FLOOR_Y, HALL, HALL_SEAT, ROOM_DOOR, VAULT_DOOR } from "./stationLayout";
import { greetingAt, greetingClock, greetingPoints } from "./vaultGreeting";

const R = VAULT_DOOR.radius;
const THICK = VAULT_DOOR.thickness;
const HINGE_OUT = VAULT_DOOR.hingeOut;
const BOLTS = 10;

export function VaultDoor() {
  const greetPts = useMemo(() => greetingPoints(), []);
  const hinge = useRef<THREE.Group>(null);
  const wheel = useRef<THREE.Group>(null);
  const bolts = useRef<THREE.Group>(null);

  const mats = useMemo(
    () => ({
      steel: new THREE.MeshStandardMaterial({ color: 0xaeb5c2, roughness: 0.28, metalness: 0.95 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x2a2f39, roughness: 0.4, metalness: 0.85 }),
      gold: new THREE.MeshStandardMaterial({ color: 0xd9a63e, roughness: 0.25, metalness: 1 }),
      frame: new THREE.MeshStandardMaterial({ color: 0x3a4152, roughness: 0.35, metalness: 0.9 }),
    }),
    [],
  );
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  // The frame plate: fills the room's doorway, with a round hole for the door,
  // a little thicker than the wall.
  const frameGeo = useMemo(() => {
    const w = ROOM_DOOR.half;
    const lo = FLOOR_Y - VAULT_DOOR.centreY;
    const hi = lo + ROOM_DOOR.top;
    const shape = new THREE.Shape();
    shape.moveTo(-w, lo);
    shape.lineTo(w, lo);
    shape.lineTo(w, hi);
    shape.lineTo(-w, hi);
    shape.closePath();
    const hole = new THREE.Path();
    hole.absarc(0, 0, R + 0.02, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: 0.2,
      bevelEnabled: false,
      curveSegments: 48,
    });
    g.translate(0, 0, -0.1);
    return g;
  }, []);
  useEffect(() => () => frameGeo.dispose(), [frameGeo]);

  useFrame(() => {
    const f = greetingAt(greetingClock(performance.now()), greetPts);
    if (hinge.current) hinge.current.rotation.y = DOOR_OPEN_ANGLE * f.door;
    // Negative: turns the same way as the robot's hands on the rim.
    if (wheel.current) wheel.current.rotation.x = -f.wheel;
    if (bolts.current)
      for (const b of bolts.current.children) {
        const bolt = b.children[0];
        if (bolt) bolt.position.z = (R + 0.06) * (1 - 0.18 * f.bolts);
      }
  });

  return (
    <>
      <HallSeat mats={mats} />
      <group position={[VAULT_DOOR.x, VAULT_DOOR.centreY, HALL.z]}>
        {/* Frame plate in the wall (faces along x). */}
        <mesh geometry={frameGeo} material={mats.frame} rotation={[0, Math.PI / 2, 0]} />
        <mesh rotation={[0, Math.PI / 2, 0]} material={mats.gold}>
          <torusGeometry args={[R + 0.05, 0.035, 10, 64]} />
        </mesh>
        {/* Hinge on the -z edge, just into the room: the door swings into the vault
          (+x), away from the desk, and folds flat against the wall. */}
        <group ref={hinge} position={[HINGE_OUT, 0, -R]}>
          <group position={[-HINGE_OUT, 0, R]}>
            <mesh rotation={[0, 0, Math.PI / 2]} material={mats.steel} castShadow>
              <cylinderGeometry args={[R, R, THICK, 64]} />
            </mesh>
            {/* Concentric rings and the gold rim on the outer face. */}
            {[R * 0.92, R * 0.7, R * 0.45].map((r, i) => (
              <mesh
                key={r}
                position={[-THICK / 2 - 0.005, 0, 0]}
                rotation={[0, Math.PI / 2, 0]}
                material={i === 0 ? mats.gold : mats.dark}
              >
                <torusGeometry args={[r, i === 0 ? 0.03 : 0.015, 8, 64]} />
              </mesh>
            ))}
            {/* Locking bolts round the edge (slide in as it unlocks). */}
            <group ref={bolts}>
              {Array.from({ length: BOLTS }, (_, i) => {
                const a = (i / BOLTS) * Math.PI * 2;
                return (
                  <group key={i} rotation={[a, 0, 0]}>
                    <mesh
                      position={[0, 0, R + 0.06]}
                      rotation={[Math.PI / 2, 0, 0]}
                      material={mats.steel}
                    >
                      <cylinderGeometry args={[0.045, 0.045, 0.16, 12]} />
                    </mesh>
                  </group>
                );
              })}
            </group>
            {/* The wheel: hub, rim and spokes, on the outer face. */}
            <group ref={wheel} position={[-THICK / 2 - 0.08, 0, 0]}>
              <mesh rotation={[0, 0, Math.PI / 2]} material={mats.gold}>
                <cylinderGeometry args={[0.09, 0.09, 0.08, 20]} />
              </mesh>
              <mesh rotation={[0, Math.PI / 2, 0]} material={mats.steel}>
                <torusGeometry args={[0.32, 0.025, 10, 40]} />
              </mesh>
              {[0, 1, 2].map((i) => (
                <mesh key={i} rotation={[(i / 3) * Math.PI, 0, 0]} material={mats.steel}>
                  <boxGeometry args={[0.03, 0.66, 0.03]} />
                </mesh>
              ))}
            </group>
            {/* Hinge barrels. */}
            {[-0.5, 0.5].map((y) => (
              <mesh key={y} position={[HINGE_OUT, y, -R]} material={mats.dark}>
                <cylinderGeometry args={[0.06, 0.06, 0.25, 12]} />
              </mesh>
            ))}
          </group>
        </group>
      </group>
    </>
  );
}

/** The robot's waiting seat in the hallway: a small padded stool (always there). */
function HallSeat({ mats }: { mats: Record<"steel" | "dark" | "gold", THREE.Material> }) {
  return (
    <group position={HALL_SEAT}>
      <mesh position={[0, 0.02, 0]} material={mats.dark}>
        <cylinderGeometry args={[0.2, 0.22, 0.04, 24]} />
      </mesh>
      <mesh position={[0, 0.22, 0]} material={mats.steel}>
        <cylinderGeometry args={[0.035, 0.035, 0.38, 12]} />
      </mesh>
      <mesh position={[0, 0.43, 0]} material={mats.dark} castShadow>
        <cylinderGeometry args={[0.24, 0.22, 0.07, 28]} />
      </mesh>
      <mesh position={[0, 0.465, 0]} rotation={[Math.PI / 2, 0, 0]} material={mats.gold}>
        <torusGeometry args={[0.235, 0.012, 8, 32]} />
      </mesh>
    </group>
  );
}
