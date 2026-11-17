// Camera flight paths. A path is a list of waypoints (where the camera is, what
// it looks at, and when), followed along a smooth curve. Station flights go
// in through the hub's hatch, pause in the hub, turn and glide down the
// hallway to the robot (stopping at the vault door while it opens, the first
// time). Asteroid flights swing in on a curve. Pure maths, so it's tested.
import * as THREE from "three";

import { LOOK } from "./look.ts";
import {
  HATCH,
  MODULE_X,
  ROOM_OFFSET,
  roomView,
  VAULT_DOOR,
  VAULT_GREETING,
} from "../interior/stationLayout.ts";

export type Pose = { position: THREE.Vector3; target: THREE.Vector3 };
export type Waypoint = Pose & { at: number };

const smooth = (u: number) => u * u * (3 - 2 * u);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Uniform Catmull-Rom between b and c, with neighbours a and d. */
function catmull(
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  d: THREE.Vector3,
  u: number,
  out: THREE.Vector3,
) {
  if (b.distanceToSquared(c) < 1e-12) return out.copy(b); // a hold: stay put
  const u2 = u * u;
  const u3 = u2 * u;
  return out
    .set(0, 0, 0)
    .addScaledVector(a, -0.5 * u3 + u2 - 0.5 * u)
    .addScaledVector(b, 1.5 * u3 - 2.5 * u2 + 1)
    .addScaledVector(c, -1.5 * u3 + 2 * u2 + 0.5 * u)
    .addScaledVector(d, 0.5 * u3 - 0.5 * u2);
}

/** Where the camera is `seconds` into the path (clamped to its ends). */
export function samplePath(points: readonly Waypoint[], seconds: number): Pose {
  const out: Pose = { position: new THREE.Vector3(), target: new THREE.Vector3() };
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return out;
  if (seconds <= first.at)
    return { position: first.position.clone(), target: first.target.clone() };
  if (seconds >= last.at) return { position: last.position.clone(), target: last.target.clone() };
  let i = 0;
  while (i < points.length - 2 && seconds >= points[i + 1]!.at) i++;
  const a = points[Math.max(0, i - 1)]!;
  const b = points[i]!;
  const c = points[i + 1]!;
  const d = points[Math.min(points.length - 1, i + 2)]!;
  const u = clamp01((seconds - b.at) / (c.at - b.at));
  // The first segment eases in and out (a deliberate pause outside the hatch);
  // the last eases out; the ones between are mostly even.
  const n = points.length - 1;
  const easeOut = 1 - (1 - u) * (1 - u);
  const k = i === 0 ? smooth(u) : i === n - 1 ? 0.5 * u + 0.5 * easeOut : 0.5 * u + 0.5 * smooth(u);
  catmull(a.position, b.position, c.position, d.position, k, out.position);
  catmull(a.target, b.target, c.target, d.target, k, out.target);
  return out;
}

/** The same path flown backwards (starting at time 0). */
export function reversePath(points: readonly Waypoint[]): Waypoint[] {
  const total = points[points.length - 1]?.at ?? 0;
  return [...points].reverse().map((p) => ({
    position: p.position.clone(),
    target: p.target.clone(),
    at: total - p.at,
  }));
}

/** Replace a path's first pose (start from wherever the camera is now). */
export function withStart(points: Waypoint[], pose: Pose): Waypoint[] {
  const first = points[0];
  if (first) {
    first.position.copy(pose.position);
    first.target.copy(pose.target);
  }
  return points;
}

/** Room view points for a module, in station coordinates. */
export function roomPoses(id: "planner" | "finance") {
  const room = v(MODULE_X[id], 0, 0).add(ROOM_OFFSET);
  const rv = roomView(id);
  return {
    camera: room.clone().add(rv.camera),
    screen: room.clone().add(rv.screen),
    screenCamera: room.clone().add(rv.screenCamera),
  };
}

/**
 * From `from` into a module's room: to the hatch, into the hub, turn, down the
 * hallway, into the room behind the robot. With `stopAtDoor` (the Vault's first
 * visit) it waits at the door while it opens. Ends at LOOK.flights.toStationSeconds
 * (plus the wait).
 */
export function stationPath(
  id: "planner" | "finance",
  from: Pose,
  opts: { stopAtDoor: boolean },
): Waypoint[] {
  const side = id === "planner" ? -1 : 1;
  const room = roomPoses(id);
  const eye = HATCH.centreY + 0.25;
  // [position, target, seconds since the previous point (before scaling)]
  const legs: [THREE.Vector3, THREE.Vector3, number][] = [
    [v(0, eye, 9), v(0, eye - 0.1, 0), 2.0], // outside, facing the hatch
    [v(0, eye, 3.0), v(0, eye, 0), 0.9], // through the hatch
    [v(0, eye + 0.1, 0.5), v(side * 6, eye, 0), 0.8], // hub centre, turning
    [v(side * 2.7, eye + 0.15, 0), v(side * 8, eye, 0), 0.7], // into the hallway
  ];
  let hold: number | null = null;
  if (opts.stopAtDoor) {
    legs.push([v(6.4, eye + 0.1, 0), v(VAULT_DOOR.x, VAULT_DOOR.centreY, 0), 0.9]);
    hold = legs.length; // the next point repeats this one, VAULT_GREETING.swing later
    legs.push([v(6.4, eye + 0.1, 0), v(VAULT_DOOR.x, VAULT_DOOR.centreY, 0), 0]);
    legs.push([v(9.0, eye + 0.3, -0.3), room.screen, 1.0]);
  } else {
    legs.push([v(side * 7.6, eye + 0.15, 0), room.screen, 0.9]);
    legs.push([v(side * 9.0, eye + 0.3, -0.3), room.screen, 0.6]);
  }
  legs.push([room.camera, room.screen, 0.7]);
  const moving = legs.reduce((s, [, , dt]) => s + dt, 0);
  const scale = LOOK.flights.toStationSeconds / moving;
  const out: Waypoint[] = [{ position: from.position.clone(), target: from.target.clone(), at: 0 }];
  let t = 0;
  legs.forEach(([p, look, dt], i) => {
    t += i === hold ? VAULT_GREETING.swing : dt * scale;
    out.push({ position: p.clone(), target: look.clone(), at: t });
  });
  return out;
}

/** When the camera reaches the vault door on a `stopAtDoor` path (seconds), or null. */
export function doorArrival(points: readonly Waypoint[]): number | null {
  for (let i = 1; i < points.length; i++) {
    if (points[i]!.position.distanceToSquared(points[i - 1]!.position) < 1e-12)
      return points[i - 1]!.at;
  }
  return null;
}

/**
 * A curved approach from `from` to `goal` at progress k (0..1): eases in and out,
 * lifts and swings to one side midway, and lands exactly on the goal.
 */
export function asteroidArc(from: Pose, goal: Pose, k: number): Pose {
  const e = smooth(clamp01(k));
  const position = from.position.clone().lerp(goal.position, e);
  const dist = from.position.distanceTo(goal.position);
  const bump = Math.sin(Math.PI * clamp01(k));
  const dir = goal.position.clone().sub(from.position).normalize();
  const sideways = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0));
  if (sideways.lengthSq() > 1e-9) sideways.normalize();
  position.addScaledVector(new THREE.Vector3(0, 1, 0), bump * 0.12 * dist);
  position.addScaledVector(sideways, bump * 0.15 * dist);
  const target = from.target.clone().lerp(goal.target, e);
  return { position, target };
}
