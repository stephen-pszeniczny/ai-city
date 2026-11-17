// Where the robot's workspace sits on an asteroid's deck, and the points the
// camera and the hologram beam need. Workspace coordinates: the robot at the
// origin facing +z, desk top at y = 0.75. Deck coordinates: the deck's centre,
// y = 0 on its top. The workspace is scaled down so the robot is small next
// to the (bigger) asteroid.
import * as THREE from "three";

/** Workspace origin (the robot's chair) on the deck. */
export const WORK_AT = new THREE.Vector3(0.3, 0, -0.2);
/** Workspace scale on the deck. */
export const WORK_SCALE = 0.65;

/** The monitor: centre and turn (yawed toward the camera, tilted back), workspace coordinates. */
export const MONITOR_AT = new THREE.Vector3(0, 1.36, 0.95);
export const MONITOR_TURN = new THREE.Euler(0.2, -0.25, 0, "YXZ");
/** The hologram projector's lens, workspace coordinates. */
export const PROJECTOR_LENS = new THREE.Vector3(0.74, 0.88, 0.8);

/** Camera distance from the screen in the screen view (fits the desktop overlay). */
const SCREEN_VIEW_DISTANCE = 1.24;

export function workToDeck(v: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  return out.copy(v).multiplyScalar(WORK_SCALE).add(WORK_AT);
}

export function deckToWork(v: THREE.Vector3, out = new THREE.Vector3()): THREE.Vector3 {
  return out.copy(v).sub(WORK_AT).divideScalar(WORK_SCALE);
}

const screenNormal = new THREE.Vector3(0, 0, -1).applyEuler(MONITOR_TURN);

/** Camera points in deck coordinates (the rig turns them with the spinning deck). */
export const DESK_SPOT = {
  /** Third person: behind, above and to the robot's left, so most of the screen shows past its head. */
  camera: workToDeck(new THREE.Vector3(1.7, 3.4, -3.7)),
  /** What the building view looks at: the screen's centre. */
  screen: workToDeck(MONITOR_AT),
  /** Screen view: square in front of the screen, along its facing direction. */
  screenCamera: workToDeck(MONITOR_AT.clone().addScaledVector(screenNormal, SCREEN_VIEW_DISTANCE)),
} as const;
