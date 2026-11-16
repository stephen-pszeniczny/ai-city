// Flies the camera between the levels: about 1.2 s, easing in and out.
// On the belt the person steers (OrbitControls); inside a building the camera
// holds a viewpoint in front of it, following the asteroid as it orbits.
// With reduced motion it jumps instead of flying.
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";

import type { BuildingId } from "../api";
import type { View } from "./levels";

export const FLIGHT_SECONDS = 1.2;

export type SceneApi = {
  /** World position of a building's centre, this frame. */
  locate(id: BuildingId, out: THREE.Vector3): THREE.Vector3;
};

type Pose = { position: THREE.Vector3; target: THREE.Vector3 };
/** The two things the rig needs from the orbit controls. */
type Controls = { target: THREE.Vector3; enabled: boolean };

const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const isStation = (id: BuildingId) => id === "planner" || id === "finance";

/** Where the camera should be for a building or screen view, right now. */
function poseFor(view: View, api: SceneApi, out: Pose): boolean {
  if (view.level === "belt") return false;
  const c = api.locate(view.id, out.target);
  const close = view.level === "screen";
  if (isStation(view.id)) {
    out.position.set(c.x, c.y + (close ? 1.5 : 3), c.z + (close ? 6 : 11));
  } else {
    const outward = new THREE.Vector3(c.x, 0, c.z).normalize();
    out.position
      .copy(c)
      .addScaledVector(outward, close ? 6 : 12)
      .add(new THREE.Vector3(0, close ? 4 : 6, 0));
    out.target.y += 2; // look at the deck, not the rock's middle
  }
  return true;
}

export function CameraRig({
  view,
  api,
  reducedMotion,
}: {
  view: View;
  api: RefObject<SceneApi | null>;
  reducedMotion: boolean;
}) {
  const { camera, controls } = useThree() as {
    camera: THREE.PerspectiveCamera;
    controls: Controls | null;
  };
  const goal = useMemo<Pose>(
    () => ({ position: new THREE.Vector3(), target: new THREE.Vector3() }),
    [],
  );
  const flight = useRef<{ from: Pose; start: number } | null>(null);
  // Where the person had steered to on the belt, so flying back returns there.
  const beltPose = useRef<Pose | null>(null);
  const viewKey = view.level === "belt" ? "belt" : `${view.level}:${view.id}`;
  const lastKey = useRef(viewKey);

  useEffect(() => {
    if (lastKey.current === viewKey) return;
    const leavingBelt = lastKey.current === "belt";
    lastKey.current = viewKey;
    const target = controls ? controls.target.clone() : new THREE.Vector3();
    if (leavingBelt)
      beltPose.current = { position: camera.position.clone(), target: target.clone() };
    flight.current = reducedMotion
      ? null
      : { from: { position: camera.position.clone(), target }, start: performance.now() };
  }, [viewKey, camera, controls, reducedMotion]);

  useFrame(() => {
    const sceneApi = api.current;
    if (!sceneApi) return;
    let hasGoal = poseFor(view, sceneApi, goal);
    if (!hasGoal && beltPose.current && flight.current) {
      goal.position.copy(beltPose.current.position);
      goal.target.copy(beltPose.current.target);
      hasGoal = true;
    }
    if (controls) controls.enabled = view.level === "belt" && !flight.current;
    if (!hasGoal) return; // on the belt, the person is steering

    const f = flight.current;
    const k = f
      ? easeInOut(Math.min(1, (performance.now() - f.start) / (FLIGHT_SECONDS * 1000)))
      : 1;
    if (f) {
      camera.position.lerpVectors(f.from.position, goal.position, k);
      const target = new THREE.Vector3().lerpVectors(f.from.target, goal.target, k);
      controls?.target.copy(target);
      camera.lookAt(target);
      if (k >= 1) flight.current = null;
    } else {
      camera.position.copy(goal.position);
      controls?.target.copy(goal.target);
      camera.lookAt(goal.target);
    }
  });

  return null;
}
