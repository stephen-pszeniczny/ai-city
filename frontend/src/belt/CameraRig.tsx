// Flies the camera between the levels: about 1.2 s, easing in and out.
// On the belt the person steers (OrbitControls); inside a building the camera
// holds a viewpoint in front of it, following the asteroid as it orbits.
// With reduced motion it jumps instead of flying.
import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";

import type { BuildingId } from "../api";
import { DESK_SPOT } from "../interior/AsteroidDesk";
import { ROOM_OFFSET, roomView } from "../interior/ControlStation";
import type { View } from "./levels";

export const FLIGHT_SECONDS = 1.2;
/** The belt view the app opens on (matches the Canvas camera in BeltCanvas). */
export const BELT_HOME = { position: [0, 22, 78], target: [0, 0, 0] } as const;
/** Lens: narrow on the belt, wider indoors so the room and window fit. */
const FOV = { belt: 38, inside: 55 } as const;

export type SceneApi = {
  /** World position of a building's centre, this frame. */
  locate(id: BuildingId, out: THREE.Vector3): THREE.Vector3;
  /** An asteroid's deck point (deck coordinates, turning with the asteroid) in world space. */
  deckToWorld(id: BuildingId, local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3;
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
    // Inside the control station: third person behind the robot, or at the screen.
    const room = new THREE.Vector3().copy(c).add(ROOM_OFFSET);
    const rv = roomView(view.id as "planner" | "finance");
    out.position.copy(room).add(close ? rv.screenCamera : rv.camera);
    out.target.copy(room).add(rv.screen);
  } else {
    // On the asteroid: third person behind the robot at its desk, turning with the deck.
    api.deckToWorld(view.id, close ? DESK_SPOT.screenCamera : DESK_SPOT.camera, out.position);
    api.deckToWorld(view.id, DESK_SPOT.screen, out.target);
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
  const flight = useRef<{ from: Pose; start: number; fov: number } | null>(null);
  // Where the person had steered to on the belt, so flying back returns there.
  // Starts at the default belt view, so leaving a building you opened directly
  // (a reload or deep link) still flies back to the belt.
  const beltPose = useRef<Pose | null>({
    position: new THREE.Vector3(...BELT_HOME.position),
    target: new THREE.Vector3(...BELT_HOME.target),
  });
  const viewKey = view.level === "belt" ? "belt" : `${view.level}:${view.id}`;
  const lastKey = useRef(viewKey);

  // useLayoutEffect, not useEffect: it runs before the next frame is drawn.
  // With useEffect a frame could move the camera to the new view first, and the
  // "belt view" saved here would then be the inside view.
  useLayoutEffect(() => {
    if (lastKey.current === viewKey) return;
    const leavingBelt = lastKey.current === "belt";
    lastKey.current = viewKey;
    const target = controls ? controls.target.clone() : new THREE.Vector3();
    if (leavingBelt)
      beltPose.current = { position: camera.position.clone(), target: target.clone() };
    // Reduced motion, back to the belt: there's no flight to carry the camera
    // home, so jump straight back to where the person had it, with the belt lens.
    if (reducedMotion && viewKey === "belt" && beltPose.current) {
      camera.position.copy(beltPose.current.position);
      controls?.target.copy(beltPose.current.target);
      camera.lookAt(beltPose.current.target);
      camera.fov = FOV.belt;
      camera.updateProjectionMatrix();
    }
    flight.current = reducedMotion
      ? null
      : {
          from: { position: camera.position.clone(), target },
          start: performance.now(),
          fov: camera.fov,
        };
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
    const fovGoal = view.level === "belt" ? FOV.belt : FOV.inside;
    const fov = f ? THREE.MathUtils.lerp(f.fov, fovGoal, k) : fovGoal;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
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
