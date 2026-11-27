// How much of something new can be seen from the building view. Pure geometry:
// it's inside the frame, and (on an asteroid) the deck's solid top isn't in front
// of it. Other things in front of it aren't checked.
import * as THREE from "three";

/** At least this share in sight counts as seen. */
export const SEEN_SHARE = 0.2;

/** An asteroid's deck: its frame (origin at the top's centre) and radius. */
export type DeckTop = { frame: THREE.Object3D; radius: number };

const MOST_POINTS = 60; // per mesh

/** The share (0 to 1) of the groups' points the camera can see. */
export function shareInView(
  groups: readonly THREE.Object3D[],
  camera: THREE.Camera,
  deck?: DeckTop,
): number {
  camera.updateMatrixWorld();
  const point = new THREE.Vector3();
  const onScreen = new THREE.Vector3();
  const eye = new THREE.Vector3();
  let total = 0;
  let seen = 0;
  if (deck) {
    deck.frame.updateWorldMatrix(true, false);
    deck.frame.worldToLocal(eye.setFromMatrixPosition(camera.matrixWorld));
  }
  for (const group of groups) {
    group.updateWorldMatrix(true, true);
    group.traverse((o) => {
      const positions = (o as THREE.Mesh).isMesh
        ? (o as THREE.Mesh).geometry.getAttribute("position")
        : undefined;
      if (!positions) return;
      const step = Math.max(1, Math.floor(positions.count / MOST_POINTS));
      for (let i = 0; i < positions.count; i += step) {
        point.fromBufferAttribute(positions, i).applyMatrix4(o.matrixWorld);
        total++;
        onScreen.copy(point).project(camera);
        if (Math.abs(onScreen.x) > 1 || Math.abs(onScreen.y) > 1 || Math.abs(onScreen.z) > 1) {
          continue;
        }
        if (deck) {
          deck.frame.worldToLocal(point);
          if (point.y < -0.01 && eye.y > 0) {
            const k = eye.y / (eye.y - point.y);
            const x = eye.x + (point.x - eye.x) * k;
            const z = eye.z + (point.z - eye.z) * k;
            if (Math.hypot(x, z) < deck.radius) continue;
          }
        }
        seen++;
      }
    });
  }
  return total ? seen / total : 0;
}
