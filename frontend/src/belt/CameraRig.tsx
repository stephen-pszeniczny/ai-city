// Flies the camera between the levels, slowly and deliberately:
//   belt → Mission Control / Vault: in through the hub's hatch, pause, turn,
//     down the hallway to the robot (waiting at the vault door the first time);
//     Back retraces the path.
//   belt ↔ asteroid: a curved swing in (about 3 s), following the moving asteroid.
//   building ↔ screen: a short lean in or out (1.2 s).
// A click or Escape during a flight finishes it. On the belt the person steers
// (OrbitControls); inside a building the camera holds its viewpoint, following
// the asteroid as it orbits. With reduced motion it jumps instead of flying.
import { useFrame, useThree } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";

import type { BuildingId } from "../api";
import { DESK_SPOT } from "../interior/AsteroidDesk";
import { ROOM_OFFSET, roomView } from "../interior/stationLayout";
import {
  asteroidArc,
  doorArrival,
  reversePath,
  samplePath,
  stationPath,
  withStart,
  type Pose,
  type Waypoint,
} from "./flightPath";
import { flightState } from "./flightState";
import type { View } from "./levels";
import { LOOK } from "./look";
import { vaultDoor } from "./vaultDoor";

/** Building ↔ screen lean, seconds. */
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

/** The two things the rig needs from the orbit controls. */
type Controls = { target: THREE.Vector3; enabled: boolean };

type Flight =
  | { kind: "path"; path: Waypoint[]; start: number; fovFrom: number; fovTo: number }
  | { kind: "arc"; from: Pose; to: "goal" | Pose; start: number; seconds: number; fovFrom: number }
  | { kind: "lean"; from: Pose; start: number; fovFrom: number };

const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const isStation = (id: BuildingId): id is "planner" | "finance" =>
  id === "planner" || id === "finance";

/** Where the camera should be for a building or screen view, right now. */
function poseFor(view: View, api: SceneApi, out: Pose): boolean {
  if (view.level === "belt") return false;
  const c = api.locate(view.id, out.target);
  const close = view.level === "screen";
  if (isStation(view.id)) {
    // Inside the control room: third person behind the robot, or at the screen.
    const room = new THREE.Vector3().copy(c).add(ROOM_OFFSET);
    const rv = roomView(view.id);
    out.position.copy(room).add(close ? rv.screenCamera : rv.camera);
    out.target.copy(room).add(rv.screen);
  } else {
    // On the asteroid: third person behind the robot at its desk, turning with the deck.
    api.deckToWorld(view.id, close ? DESK_SPOT.screenCamera : DESK_SPOT.camera, out.position);
    api.deckToWorld(view.id, DESK_SPOT.screen, out.target);
  }
  return true;
}

/** The Vault's first visit of the session: claim the door opening and say when it plays. */
function claimVault(atMs: number): boolean {
  if (!vaultDoor.claimFirstOpening()) return false;
  vaultDoor.scheduleOpening(atMs);
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
  const flight = useRef<Flight | null>(null);
  // Where the person had steered to on the belt, so flying back returns there.
  // Starts at the default belt view, so leaving a building you opened directly
  // (a reload or deep link) still flies back to the belt.
  const beltPose = useRef<Pose>({
    position: new THREE.Vector3(...BELT_HOME.position),
    target: new THREE.Vector3(...BELT_HOME.target),
  });
  const viewKey = view.level === "belt" ? "belt" : `${view.level}:${view.id}`;
  const last = useRef<{ key: string; view: View }>({ key: viewKey, view });

  // Opened straight into the Vault (a reload or link): the greeting plays in place.
  useLayoutEffect(() => {
    if (view.level !== "belt" && view.id === "finance") claimVault(performance.now());
    // Only on first mount.
  }, []);

  // useLayoutEffect, not useEffect: it runs before the next frame is drawn.
  // With useEffect a frame could move the camera to the new view first, and the
  // "belt view" saved here would then be the inside view.
  useLayoutEffect(() => {
    if (last.current.key === viewKey) return;
    const prev = last.current.view;
    last.current = { key: viewKey, view };
    const now = performance.now();
    const current: Pose = {
      position: camera.position.clone(),
      target: controls ? controls.target.clone() : new THREE.Vector3(),
    };
    if (prev.level === "belt")
      beltPose.current = { position: current.position.clone(), target: current.target.clone() };

    if (reducedMotion) {
      flight.current = null;
      flightState.end();
      if (view.level !== "belt" && view.id === "finance") claimVault(now);
      if (view.level === "belt") {
        // No flight to carry the camera home: jump back to where the person had it.
        camera.position.copy(beltPose.current.position);
        controls?.target.copy(beltPose.current.target);
        camera.lookAt(beltPose.current.target);
        camera.fov = FOV.belt;
        camera.updateProjectionMatrix();
      }
      return;
    }

    const fovFrom = camera.fov;
    if (prev.level === "belt" && view.level === "building" && isStation(view.id)) {
      const stopAtDoor = view.id === "finance" && !vaultDoor.isOpen();
      const path = stationPath(view.id, current, { stopAtDoor });
      if (stopAtDoor) claimVault(now + (doorArrival(path) ?? 0) * 1000);
      flight.current = { kind: "path", path, start: now, fovFrom, fovTo: FOV.inside };
    } else if (prev.level === "building" && isStation(prev.id) && view.level === "belt") {
      const path = withStart(
        reversePath(stationPath(prev.id, beltPose.current, { stopAtDoor: false })),
        current,
      );
      flight.current = { kind: "path", path, start: now, fovFrom, fovTo: FOV.belt };
    } else if (prev.level === "belt" && view.level === "building") {
      flight.current = {
        kind: "arc",
        from: current,
        to: "goal",
        start: now,
        seconds: LOOK.flights.toAsteroidSeconds,
        fovFrom,
      };
    } else if (view.level === "belt") {
      const home = {
        position: beltPose.current.position.clone(),
        target: beltPose.current.target.clone(),
      };
      flight.current = {
        kind: "arc",
        from: current,
        to: home,
        start: now,
        seconds: LOOK.flights.toAsteroidSeconds,
        fovFrom,
      };
    } else {
      flight.current = { kind: "lean", from: current, start: now, fovFrom };
    }
    flightState.start();
  }, [viewKey, view, camera, controls, reducedMotion]);

  useFrame(() => {
    const sceneApi = api.current;
    if (!sceneApi) return;
    const hasGoal = poseFor(view, sceneApi, goal);
    const f = flight.current;
    if (controls) controls.enabled = view.level === "belt" && !f;
    if (!f) {
      if (!hasGoal) return; // on the belt, the person is steering
      setFov(view.level === "belt" ? FOV.belt : FOV.inside);
      place(goal);
      return;
    }

    const elapsed = (performance.now() - f.start) / 1000;
    const skip = flightState.skipRequested();
    let pose: Pose;
    let k: number;
    let fovTo: number = view.level === "belt" ? FOV.belt : FOV.inside;
    if (f.kind === "path") {
      const total = f.path[f.path.length - 1]?.at ?? 0;
      const t = skip ? total : Math.min(elapsed, total);
      k = total > 0 ? t / total : 1;
      pose = samplePath(f.path, t);
      // The live goal can drift (it shouldn't for the station, but be exact at the end).
      if (k >= 1 && hasGoal) pose = goal;
      fovTo = f.fovTo;
    } else if (f.kind === "arc") {
      k = skip ? 1 : Math.min(1, elapsed / f.seconds);
      const to = f.to === "goal" ? goal : f.to;
      pose = asteroidArc(f.from, to, k);
    } else {
      k = skip ? 1 : Math.min(1, elapsed / FLIGHT_SECONDS);
      const e = easeInOut(k);
      pose = {
        position: f.from.position.clone().lerp(goal.position, e),
        target: f.from.target.clone().lerp(goal.target, e),
      };
    }
    setFov(THREE.MathUtils.lerp(f.fovFrom, fovTo, easeInOut(Math.min(1, k * 1.6))));
    place(pose);
    if (k >= 1) {
      flight.current = null;
      flightState.end();
    }
  });

  function setFov(fov: number) {
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }
  function place(p: Pose) {
    camera.position.copy(p.position);
    controls?.target.copy(p.target);
    camera.lookAt(p.target);
  }

  return null;
}
