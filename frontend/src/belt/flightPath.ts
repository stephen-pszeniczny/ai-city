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
