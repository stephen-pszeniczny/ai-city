// An asteroid's robot at work: a tinted desk on the asteroid's deck with the
// computer, props, the building's gadget and (while unbuilt) the hologram
// projector and the "under construction" sign. Every asteroid has one all
// the time, so the belt, the building view and the screen view always show
// the same world; far from the camera it switches to a lighter version.
// It sits on the asteroid's spinning deck, so the view sweeps slowly as it turns.
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

import type { BuildingId } from "../api";
import { DECK_R } from "../belt/asteroids";
import { deskLights } from "../belt/deskLights";
import { detailFor, type Detail } from "../belt/lod";
import { Desk, DESK_Z } from "./Desk";
import { DeskProps } from "./DeskProps";
import { Gadget } from "./Gadget";
import { Monitor, type ScreenLine } from "./Monitor";
import { Robot, useRobotBrain } from "./Robot";
import { deckToWork, MONITOR_AT, MONITOR_TURN, WORK_AT, WORK_SCALE } from "./workspace";

export { DESK_SPOT } from "./workspace";

/** The sign stands beside the desk, a little behind it, deck coordinates. */
const SIGN_AT = new THREE.Vector3(-1.45, 0, 1.55);

export function AsteroidDesk({
  id,
  title,
  tint,
  built,
  lines,
  inside,
  atScreen,
  sign,
  reducedMotion,
  onDesk,
}: {
  id: BuildingId;
  title: string;
  tint: string;
  built: boolean;
  /** Mission Control's open tasks (empty elsewhere). */
  lines: readonly ScreenLine[];
  /** The camera is in this building (always full detail). */
  inside: boolean;
  /** Zoomed into the screen: the desktop overlay takes the monitor's place, so it and the robot hide. */
  atScreen: boolean;
  /** The asteroid's solid "under construction" sign, or null once built. */
  sign: THREE.Group | null;
  reducedMotion: boolean;
  /** Clicking the desk or screen (and the robot, from outside the building). */
  onDesk: () => void;
}) {
  const brain = useRobotBrain(id + tint);
  const root = useRef<THREE.Group>(null);
  const [detail, setDetail] = useState<Detail>("far");
  const nextCheck = useRef(0);
  const where = useMemo(() => new THREE.Vector3(), []);
  const workMark = useRef<THREE.Object3D>(null);
  const glowMark = useRef<THREE.Object3D>(null);
  const lampMark = useRef<THREE.Object3D>(null);

  useEffect(() => {
    const [work, glow, lamp] = [workMark.current, glowMark.current, lampMark.current];
    if (!work || !glow || !lamp) return;
    deskLights.register(id, { work, glow, lamp });
    return () => deskLights.unregister(id);
  }, [id]);
  useEffect(() => deskLights.setNear(id, detail === "near"), [id, detail]);

  // Pick near or far detail twice a second from the camera's distance.
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (t < nextCheck.current || !root.current) return;
    nextCheck.current = t + 0.5;
    root.current.getWorldPosition(where);
    const d = inside ? "near" : detailFor(where.distanceTo(state.camera.position));
    if (d !== detail) setDetail(d);
  });

  const click = (robot: boolean) => (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 5) return; // a drag, not a click
    e.stopPropagation();
    if (robot && inside) brain.react();
    else onDesk();
  };

  const orbit = useMemo(
    () => ({ centre: deckToWork(new THREE.Vector3(0, 0, 0)), radius: (DECK_R + 0.6) / WORK_SCALE }),
    [],
  );
  const near = detail === "near";

  return (
    <group>
      <group ref={root} position={WORK_AT} scale={WORK_SCALE}>
        <group onClick={click(true)} visible={!atScreen}>
          <Robot tint={tint} brain={brain} detail={detail} />
        </group>
        <group onClick={click(false)}>
          <group position={[0, 0, DESK_Z]}>
            <Desk tint={tint} detail={detail} />
          </group>
          <DeskProps tint={tint} detail={detail} projector={!built} lampMark={lampMark} />
          <Gadget id={id} tint={tint} detail={detail} reducedMotion={reducedMotion} orbit={orbit} />
          <group position={MONITOR_AT} rotation={MONITOR_TURN} visible={!atScreen}>
            <Monitor
              id={id}
              title={title}
              tint={tint}
              built={built}
              lines={lines}
              brain={brain}
              live={near}
            />
          </group>
        </group>
        {/* Where the shared close-up lights sit at this desk (belt/deskLights.ts):
            a warm work light and the screen's cool glow. */}
        <object3D ref={workMark} position={[0.6, 2.6, -0.9]} />
        <object3D ref={glowMark} position={[0, 1.3, 0.5]} />
      </group>
      {/* dispose={null}: the sign belongs to the asteroid and is reused, never freed here. */}
      {sign && <primitive object={sign} dispose={null} position={SIGN_AT} rotation={[0, 0.3, 0]} />}
    </group>
  );
}
