// An asteroid's robot at work: a desk on the asteroid's deck, tinted to
// match, with the computer screen; open space all around. While the building
// isn't built, the "under construction" sign stands beside the desk.
// It sits on the asteroid's spinning deck, so the view sweeps slowly as it turns.
import type { ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";

import { Desk } from "./Desk";
import { Monitor } from "./Monitor";
import { Robot } from "./Robot";

/**
 * Layout in deck coordinates (origin on the deck top, centre). The camera rig
 * turns these into world positions through the spinning deck.
 */
export const DESK_SPOT = {
  robot: new THREE.Vector3(0, 0, -0.45),
  desk: new THREE.Vector3(0, 0, 0.31),
  screen: new THREE.Vector3(0, 1.36, 0.5),
  sign: new THREE.Vector3(1.45, 0, 0.95),
  /** Third person: behind and a little to the right of the robot, over its shoulder. */
  camera: new THREE.Vector3(0.8, 2.15, -2.5),
  /** Screen view: straight in front of the screen. */
  screenCamera: new THREE.Vector3(0, 1.36, -0.48),
} as const;

export function AsteroidDesk({
  title,
  tint,
  sign,
  onOpenScreen,
}: {
  title: string;
  tint: string;
  /** The asteroid's solid "under construction" sign, or null once built. */
  sign: THREE.Group | null;
  onOpenScreen: () => void;
}) {
  const click = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 5) return;
    e.stopPropagation();
    onOpenScreen();
  };

  return (
    <group>
      <group onClick={click}>
        <group position={DESK_SPOT.robot}>
          <Robot tint={tint} />
        </group>
        <group position={DESK_SPOT.desk}>
          <Desk tint={tint} />
        </group>
        <group position={DESK_SPOT.screen} rotation={[0.08, 0, 0]}>
          <Monitor title={title} tint={tint} />
        </group>
      </group>
      {/* dispose={null}: the sign is reused on the next visit, so never free it here. */}
      {sign && (
        <primitive
          object={sign}
          dispose={null}
          position={DESK_SPOT.sign}
          rotation={[0, -0.55, 0]}
        />
      )}
      {/* A small work light, so the robot reads against the dark. */}
      <pointLight position={[0.3, 2.2, -0.6]} intensity={4} distance={5} color={0xffe2c0} />
      <pointLight position={[0, 1.3, 0.2]} intensity={1.8} distance={2.5} color={0x8aa4ff} />
    </group>
  );
}
