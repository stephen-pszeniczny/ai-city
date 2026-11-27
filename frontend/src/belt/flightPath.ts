// Camera flights to the asteroids: a curved swing in (and back out). Station
// flights live in stationRoute.ts. Pure maths, so it's tested.
import * as THREE from "three";

export type Pose = { position: THREE.Vector3; target: THREE.Vector3 };

const smooth = (u: number) => u * u * (3 - 2 * u);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

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

/**
 * How the flight to a desk lines up: how far back along the desk camera's own view
 * the swing aims, when the run down that line starts and when the swing is over
 * (both as shares of the flight; they overlap, so the camera never stops), and how
 * much the swing rises midway (a share of the distance flown, up to `highest`). The
 * rise carries it clear of the station and, mostly, of the neighbouring asteroids.
 */
export const APPROACH = {
  back: 16,
  runFrom: 0.5,
  swingUntil: 0.75,
  lift: 0.32,
  highest: 22,
} as const;

/** Which way round a flight turned, kept from frame to frame. */
export type Turn = { angle?: number };

const FULL_TURN = Math.PI * 2;

/**
 * The curved flight to an asteroid's desk at progress k (0..1). It swings round
 * the asteroid, outside whatever has been built on it, to a point well behind the
 * desk camera, and comes the rest of the way straight along that camera's own
 * view. Flying out is the same path backwards (1 - k), with `from` the belt
 * viewpoint. `goal` may move: pass where the desk view is this frame, and the same
 * `turn` every frame so the swing never changes sides partway.
 */
export function asteroidApproach(from: Pose, goal: Pose, k: number, turn: Turn = {}): Pose {
  const progress = clamp01(k);
  const run = smooth(clamp01((progress - APPROACH.runFrom) / (1 - APPROACH.runFrom)));
  const behind = goal.position.clone().sub(goal.target).normalize();
  const aim = goal.position.clone().addScaledVector(behind, APPROACH.back * (1 - run));
  const swing = smooth(clamp01(progress / APPROACH.swingUntil));

  // Round the desk's screen: the bearing, the distance out and the height each
  // ease from the starting viewpoint to the point being aimed at.
  const start = new THREE.Cylindrical().setFromVector3(from.position.clone().sub(goal.target));
  const end = new THREE.Cylindrical().setFromVector3(aim.clone().sub(goal.target));
  let angle = end.theta - start.theta;
  angle -= FULL_TURN * Math.round((angle - (turn.angle ?? 0)) / FULL_TURN);
  turn.angle = angle;
  const position = new THREE.Vector3()
    .setFromCylindricalCoords(
      THREE.MathUtils.lerp(start.radius, end.radius, swing),
      start.theta + angle * swing,
      THREE.MathUtils.lerp(start.y, end.y, swing),
    )
    .add(goal.target);
  // A rise midway, gone (and level) once lined up.
  const rise = Math.min(APPROACH.highest, APPROACH.lift * from.position.distanceTo(goal.position));
  position.y += Math.sin(Math.PI * swing) * rise;
  const target = from.target.clone().lerp(goal.target, swing);
  return { position, target };
}
