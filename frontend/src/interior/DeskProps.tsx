// The things on the robot's desk: mouse and mat, a desk lamp, a small plant,
// the monitor cable and the hologram projector. (The water glass belongs to
// the robot, which picks it up.) Robot-space coordinates: the robot sits at
// the origin facing +z; the desk top is at y = 0.75.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import type { Detail } from "../belt/lod";
import { ROBOT } from "./Robot";
import { PROJECTOR_LENS } from "./workspace";

const TOP = 0.75;

export function DeskProps({
  tint,
  detail,
  projector,
}: {
  tint: string;
  detail: Detail;
  /** Show the hologram projector (only while the building is unbuilt). */
  projector: boolean;
}) {
  const mats = useMemo(() => {
    const t = new THREE.Color(tint);
    return {
      mat: new THREE.MeshStandardMaterial({ color: 0x15181f, roughness: 0.9 }),
      mouse: new THREE.MeshPhysicalMaterial({
        color: 0xe9edf3,
        roughness: 0.3,
        clearcoat: 0.7,
      }),
      metal: new THREE.MeshStandardMaterial({ color: 0x9aa3b2, roughness: 0.3, metalness: 0.9 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x22262f, roughness: 0.5, metalness: 0.6 }),
      bulb: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe2b0).multiplyScalar(1.6) }),
      pot: new THREE.MeshStandardMaterial({ color: 0xd9cfc2, roughness: 0.8 }),
      soil: new THREE.MeshStandardMaterial({ color: 0x3a2a1d, roughness: 1 }),
      leaf: new THREE.MeshStandardMaterial({
        color: 0x3f9b4a,
        roughness: 0.6,
        side: THREE.DoubleSide,
      }),
      leafLight: new THREE.MeshStandardMaterial({
        color: 0x6cc36a,
        roughness: 0.6,
        side: THREE.DoubleSide,
      }),
      cable: new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.7 }),
      lens: new THREE.MeshBasicMaterial({
        color: new THREE.Color(tint).lerp(new THREE.Color(0x7fe8ff), 0.5).multiplyScalar(2),
        toneMapped: false,
      }),
      tintGlow: new THREE.MeshBasicMaterial({
        color: t.clone().multiplyScalar(1.4),
        toneMapped: false,
      }),
    };
  }, [tint]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  // Plant leaves: a few curved blades around the pot, made once.
  const leaves = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.quadraticCurveTo(0.03, 0.06, 0, 0.14);
    shape.quadraticCurveTo(-0.03, 0.06, 0, 0);
    const geo = new THREE.ShapeGeometry(shape, 6);
    return {
      geo,
      list: Array.from({ length: 9 }, (_, i) => ({
        yaw: (i / 9) * Math.PI * 2 + (i % 2) * 0.3,
        tilt: 0.35 + (i % 3) * 0.18,
        scale: 0.8 + ((i * 37) % 10) / 25,
        light: i % 3 === 0,
      })),
    };
  }, []);
  useEffect(() => () => leaves.geo.dispose(), [leaves]);

  const lensRef = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (lensRef.current)
      lensRef.current.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 6) * 0.08);
  });

  const near = detail === "near";
  const m = ROBOT.mouse;
  return (
    <group>
      {/* Mouse on its mat. */}
      <mesh position={[m.x, TOP + 0.002, m.z]} material={mats.mat}>
        <boxGeometry args={[0.2, 0.004, 0.17]} />
      </mesh>
      <mesh
        position={[m.x, TOP + 0.016, m.z]}
        scale={[0.7, 0.45, 1]}
        material={mats.mouse}
        castShadow
      >
        <sphereGeometry args={[0.045, 16, 10]} />
      </mesh>

      {/* Plant in a pot, back right. */}
      <group position={[0.76, TOP, 1.0]}>
        <mesh position={[0, 0.05, 0]} material={mats.pot} castShadow>
          <cylinderGeometry args={[0.055, 0.042, 0.1, 18]} />
        </mesh>
        <mesh position={[0, 0.098, 0]} material={mats.soil}>
          <cylinderGeometry args={[0.05, 0.05, 0.006, 18]} />
        </mesh>
        {near &&
          leaves.list.map((l, i) => (
            <group key={i} position={[0, 0.1, 0]} rotation={[0, l.yaw, 0]}>
              <mesh
                geometry={leaves.geo}
                rotation={[l.tilt, 0, 0]}
                scale={l.scale}
                material={l.light ? mats.leafLight : mats.leaf}
              />
            </group>
          ))}
        {!near && (
          <mesh position={[0, 0.16, 0]} material={mats.leaf}>
            <sphereGeometry args={[0.07, 8, 6]} />
          </mesh>
        )}
      </group>

      {/* Desk lamp, back left, bending over toward the keyboard. */}
      {near && (
        <group position={[-0.76, TOP, 1.0]} rotation={[0, -0.9, 0]}>
          <mesh position={[0, 0.01, 0]} material={mats.dark}>
            <cylinderGeometry args={[0.07, 0.08, 0.02, 20]} />
          </mesh>
          <mesh position={[0, 0.17, -0.03]} rotation={[-0.2, 0, 0]} material={mats.metal}>
            <cylinderGeometry args={[0.009, 0.009, 0.32, 8]} />
          </mesh>
          <mesh position={[0, 0.34, -0.15]} rotation={[-1.1, 0, 0]} material={mats.metal}>
            <cylinderGeometry args={[0.009, 0.009, 0.26, 8]} />
          </mesh>
          <group position={[0, 0.39, -0.27]} rotation={[0.9, 0, 0]}>
            <mesh material={mats.dark}>
              <coneGeometry args={[0.06, 0.09, 20, 1, true]} />
            </mesh>
            <mesh position={[0, -0.03, 0]} material={mats.bulb}>
              <sphereGeometry args={[0.022, 10, 8]} />
            </mesh>
          </group>
          <pointLight position={[0, 0.3, -0.32]} intensity={1.2} distance={1.6} color={0xffd9a8} />
        </group>
      )}

      {/* Monitor cable dropping behind the desk. */}
      {near && (
        <mesh position={[0.06, TOP - 0.12, 1.06]} material={mats.cable}>
          <cylinderGeometry args={[0.008, 0.008, 0.3, 6]} />
        </mesh>
      )}

      {/* Hologram projector: a little box with a glowing lens, aimed up. */}
      {projector && (
        <group position={[PROJECTOR_LENS.x, TOP, PROJECTOR_LENS.z]}>
          <mesh position={[0, 0.05, 0]} material={mats.dark} castShadow>
            <boxGeometry args={[0.16, 0.1, 0.14]} />
          </mesh>
          <mesh position={[0, 0.101, 0]} material={mats.metal}>
            <cylinderGeometry args={[0.04, 0.045, 0.02, 20]} />
          </mesh>
          <mesh ref={lensRef} position={[0, PROJECTOR_LENS.y - TOP, 0]} material={mats.lens}>
            <sphereGeometry args={[0.024, 12, 8]} />
          </mesh>
          <mesh position={[0, 0.05, -0.071]} material={mats.tintGlow}>
            <boxGeometry args={[0.1, 0.012, 0.002]} />
          </mesh>
        </group>
      )}
    </group>
  );
}
