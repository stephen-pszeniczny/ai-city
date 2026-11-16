// Mission Control's and the Vault's control station: a room in that module's
// half of the station. The robot sits at a rocket-style console with a large
// screen; behind them a big window looks out at the real belt, so asteroids
// drift past as they orbit. Seen third person from behind the robot.
import type { ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { Console } from "./Console";
import { Monitor, SCREEN, type ScreenContent } from "./Monitor";
import { Robot } from "./Robot";

/**
 * Room layout in room coordinates (origin on the floor under the robot, the
 * window toward +z). The camera rig uses these for the building and screen views.
 */
export const ROOM = {
  /** Room origin relative to the module's centre (floor below the module axis). */
  offset: new THREE.Vector3(0, -1.0, 0),
  /** Where the screen's centre is. */
  screen: new THREE.Vector3(0, 1.36, 1.0),
  /** Third person: behind and a little to the right of the robot, over its shoulder. */
  camera: new THREE.Vector3(0.8, 2.15, -2.05),
  /** Screen view: in front of the screen, far enough back that the monitor
   * fills about two thirds of the width (where the desktop overlay sits). */
  screenCamera: new THREE.Vector3(0, 1.36, -0.24),
} as const;

const W = 3.6; // room width
const H = 2.6; // ceiling height
const BACK = -2.4;
const FRONT = 1.9; // window wall

export function ControlStation({
  title,
  tint,
  content,
  atScreen,
  onOpenScreen,
}: {
  title: string;
  tint: string;
  /** What the robot's screen shows. */
  content: ScreenContent;
  /** Zoomed into the screen: the camera leans in past the robot, and the desktop
   * overlay takes the monitor's place, so both are hidden. */
  atScreen: boolean;
  onOpenScreen: () => void;
}) {
  const mats = useMemo(() => {
    const t = new THREE.Color(tint);
    return {
      wall: new THREE.MeshStandardMaterial({ color: 0x232936, roughness: 0.7, metalness: 0.4 }),
      panel: new THREE.MeshStandardMaterial({ color: 0x2d3444, roughness: 0.6, metalness: 0.5 }),
      floor: new THREE.MeshStandardMaterial({ color: 0x181c25, roughness: 0.8, metalness: 0.3 }),
      frame: new THREE.MeshStandardMaterial({ color: 0x3a4152, roughness: 0.4, metalness: 0.8 }),
      strip: new THREE.MeshBasicMaterial({ color: t.clone().multiplyScalar(1.3) }),
      glass: new THREE.MeshBasicMaterial({
        color: 0x9fb6ff,
        transparent: true,
        opacity: 0.05,
        depthWrite: false,
      }),
    };
  }, [tint]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

  const click = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 5) return;
    e.stopPropagation();
    onOpenScreen();
  };

  return (
    <group position={ROOM.offset}>
      {/* Floor, ceiling and side walls with panel seams and a tint light strip. */}
      <mesh position={[0, -0.05, (BACK + FRONT) / 2]} material={mats.floor} receiveShadow>
        <boxGeometry args={[W, 0.1, FRONT - BACK]} />
      </mesh>
      <mesh position={[0, H + 0.05, (BACK + FRONT) / 2]} material={mats.wall}>
        <boxGeometry args={[W, 0.1, FRONT - BACK]} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s} position={[(s * W) / 2, H / 2, (BACK + FRONT) / 2]}>
          <mesh material={mats.wall}>
            <boxGeometry args={[0.1, H, FRONT - BACK]} />
          </mesh>
          {[-1.4, -0.4, 0.6].map((z) => (
            <mesh key={z} position={[-s * 0.06, 0.1, z]} material={mats.panel}>
              <boxGeometry args={[0.02, 1.4, 0.9]} />
            </mesh>
          ))}
          <mesh position={[-s * 0.07, H / 2 - 0.2, 0]} material={mats.strip}>
            <boxGeometry args={[0.02, 0.03, FRONT - BACK - 0.4]} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, H / 2, BACK]} material={mats.wall}>
        <boxGeometry args={[W, H, 0.1]} />
      </mesh>

      {/* Window wall: a big frame open to space, with faint glass. */}
      <group position={[0, 0, FRONT]}>
        <mesh position={[0, 0.45, 0]} material={mats.wall}>
          <boxGeometry args={[W, 0.9, 0.12]} />
        </mesh>
        <mesh position={[0, H - 0.1, 0]} material={mats.wall}>
          <boxGeometry args={[W, 0.2, 0.12]} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * (W / 2 - 0.12), H / 2, 0]} material={mats.frame}>
            <boxGeometry args={[0.24, H, 0.14]} />
          </mesh>
        ))}
        {[-0.6, 0.6].map((x) => (
          <mesh key={x} position={[x, 1.65, 0]} material={mats.frame}>
            <boxGeometry args={[0.05, 1.5, 0.1]} />
          </mesh>
        ))}
        <mesh position={[0, 1.65, 0.02]} material={mats.glass}>
          <planeGeometry args={[W - 0.5, 1.5]} />
        </mesh>
      </group>

      {/* The work area. Clicking the robot, the console or the screen opens the screen. */}
      <group onClick={click}>
        <group visible={!atScreen}>
          <Robot tint={tint} />
        </group>
        <Console tint={tint} />
        <group position={ROOM.screen} rotation={[0.08, 0, 0]} visible={!atScreen}>
          <Monitor title={title} tint={tint} content={content} />
        </group>
      </group>

      {/* Light: warm from the ceiling, cool from the screen. */}
      <pointLight position={[0, H - 0.3, -0.4]} intensity={6} distance={6} color={0xffe2c0} />
      <pointLight position={[0, 1.3, 0.6]} intensity={2.5} distance={3} color={0x8aa4ff} />
    </group>
  );
}

/** World position of a room point, for a module centred at `moduleCentre`. */
export function roomToWorld(moduleCentre: THREE.Vector3, local: THREE.Vector3, out: THREE.Vector3) {
  return out.copy(moduleCentre).add(ROOM.offset).add(local);
}

export { SCREEN };
