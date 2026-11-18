// Where the notification shuttle flies: a gentle arc across the camera's view,
// from just off one side of the screen to just off the other, in the upper half
// (below the top bar), worked out from the camera at launch so it crosses the
// screen whatever way the belt has been turned or zoomed.
import * as THREE from "three";

export type ShuttlePath = { from: THREE.Vector3; via: THREE.Vector3; to: THREE.Vector3 };

/** Distance out, as a share of the camera's distance to what it looks at. */
const DEPTH = 0.4;
/** Height on screen as a share of the half-height (0 middle, 1 top edge). */
const HEIGHT = 0.38;
/** How much higher the middle of the arc is, as a share of the half-height. */
const ARC = 0.12;
/** Wide enough to start off screen on any window up to this width:height. */
const WIDEST_ASPECT = 2.4;
const UP = new THREE.Vector3(0, 1, 0);

export function shuttlePath(
  cameraPos: THREE.Vector3,
  cameraTarget: THREE.Vector3,
  fovDeg: number,
): ShuttlePath {
  const forward = cameraTarget.clone().sub(cameraPos);
  const depth = forward.length() * DEPTH;
  forward.normalize();
  const right = forward.clone().cross(UP).normalize();
  const up = right.clone().cross(forward).normalize();

  const halfH = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2) * depth;
  const halfW = halfH * WIDEST_ASPECT * 1.15;
  const centre = cameraPos
    .clone()
    .addScaledVector(forward, depth)
    .addScaledVector(up, halfH * HEIGHT);

  return {
    from: centre.clone().addScaledVector(right, -halfW),
    via: centre.clone().addScaledVector(up, halfH * ARC * 2), // a Bézier's middle reaches half its control's lift
    to: centre.clone().addScaledVector(right, halfW),
  };
}

/** The point k of the way along (0 start, 1 end): a quadratic Bézier. */
export function pointOnPath(p: ShuttlePath, k: number, out = new THREE.Vector3()): THREE.Vector3 {
  const a = (1 - k) * (1 - k);
  const b = 2 * (1 - k) * k;
  const c = k * k;
  return out
    .set(0, 0, 0)
    .addScaledVector(p.from, a)
    .addScaledVector(p.via, b)
    .addScaledVector(p.to, c);
}
