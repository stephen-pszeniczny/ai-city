import * as THREE from "three";

// Measurements of the station's inside, in station coordinates (origin at the
// hub's centre, x toward the Vault, Mission Control at -x). Shared by the 3D
// rooms and the camera paths, so they always agree.
//
//   [Mission Control room]==hallway==( hub )==hallway==[vault door|Vault room]
//                                       ^ hatch (+z): where the camera comes in
export const FLOOR_Y = -1.0;

type Module = "planner" | "finance";

export const HUB = { radius: 2.4, height: 2.8 } as const;

/** Both hallways run along x at z = HALL.z, from the hub's wall to the room's side wall. */
export const HALL = { z: 0, width: 1.9, height: 2.4, startX: 2.1, endX: 8.3 } as const;

/** Module centres (rooms are built around these, see roomView below). */
export const MODULE_X = { planner: -10.5, finance: 10.5 } as const;

/** Room size (x by z) and ceiling. The window is the front (+z) wall. */
export const ROOM_SIZE = { width: 4.4, back: -2.4, front: 1.9, height: 2.8 } as const;

/** The vault door sits in the Vault room's inner side wall, on the hallway's line. */
export const VAULT_DOOR = { x: HALL.endX, radius: 0.95, centreY: FLOOR_Y + 1.05 } as const;

/** The hub's hatch (where the camera flies in from outside). */
export const HATCH = { z: HUB.radius, centreY: FLOOR_Y + 1.2 } as const;

/** Vault opening timeline (seconds from when it starts). */
export const VAULT_OPENING = { unlock: 1.0, swing: 2.6, wave: 4.2, seated: 6.2 } as const;

/** Room origin relative to its module's centre (floor below the module axis). */
export const ROOM_OFFSET = new THREE.Vector3(0, -1.0, 0);
/** Which side wall has the hallway door (+x for Mission Control, -x for the Vault). */
export const doorSide = (m: Module) => (m === "planner" ? 1 : -1);

const MONITOR_AT = new THREE.Vector3(0, 1.36, 1.1);
const SCREEN_VIEW_DISTANCE = 1.24;

/** Camera points for a room (room coordinates). */
export function roomView(m: Module) {
  const side = doorSide(m);
  const turn = new THREE.Euler(0.2, -0.25 * side, 0, "YXZ");
  const normal = new THREE.Vector3(0, 0, -1).applyEuler(turn);
  return {
    turn,
    /** Third person: behind, above and to one side of the robot, so most of the screen shows. */
    camera: new THREE.Vector3(1.2 * side, 2.3, -2.2),
    screen: MONITOR_AT.clone(),
    screenCamera: MONITOR_AT.clone().addScaledVector(normal, SCREEN_VIEW_DISTANCE),
  };
}
