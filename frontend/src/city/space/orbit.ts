// Where each asteroid building is on the ring at time t (seconds).
//
// All asteroids share one flat orbital plane (spec section 7: same plane, no
// random heights) with only a gentle bob. Kept free of three.js so Node's test
// runner can load it directly.
import type { BuildingId } from "../../api";

export const ORBIT_R = 38;
/** Radians per second: an asteroid takes about 40 s to cross the station window. */
export const ORBIT_SPEED = 0.02;
export const ORBIT_SPEED_REDUCED = 0.004;
const BOB = 0.25;

export const ASTEROIDS: readonly { id: BuildingId; tint: string; angleDeg: number }[] = [
  { id: "jobs", tint: "#41c9d6", angleDeg: 347 },
  { id: "mail", tint: "#ffb547", angleDeg: 38 },
  { id: "gym", tint: "#ff5d6c", angleDeg: 89 },
  { id: "projects", tint: "#ff7a45", angleDeg: 141 },
  { id: "relationships", tint: "#ff7ab8", angleDeg: 192 },
  { id: "career", tint: "#9b7bff", angleDeg: 244 },
  { id: "library", tint: "#55d39a", angleDeg: 295 },
];

/** Angle on the ring, in radians. */
export function orbitAngle(angleDeg: number, t: number, speed: number): number {
  return (angleDeg * Math.PI) / 180 + t * speed;
}

/** World position [x, y, z] on the ring. */
export function orbitPosition(
  angleDeg: number,
  t: number,
  speed: number,
): [number, number, number] {
  const a = orbitAngle(angleDeg, t, speed);
  const start = (angleDeg * Math.PI) / 180;
  return [Math.cos(a) * ORBIT_R, Math.sin(t * 0.3 + start) * BOB, Math.sin(a) * ORBIT_R];
}
