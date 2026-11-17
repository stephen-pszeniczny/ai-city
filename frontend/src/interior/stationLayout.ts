// Measurements of the station's inside, in station coordinates (origin at the
// hub's centre, x toward the Vault, Mission Control at -x). Shared by the 3D
// rooms and the camera paths, so they always agree.
//
//   [Mission Control room]==hallway==( hub )==hallway==[vault door|Vault room]
//                                       ^ hatch (+z): where the camera comes in
export const FLOOR_Y = -1.0;

export const HUB = { radius: 2.4, height: 2.8 } as const;

/** Both hallways run along x at z = HALL.z, from the hub's wall to the room's side wall. */
export const HALL = { z: 0, width: 1.9, height: 2.4, startX: 2.1, endX: 8.3 } as const;

/** Module centres (rooms are built around these, see ROOM in ControlStation). */
export const MODULE_X = { planner: -10.5, finance: 10.5 } as const;

/** Room size (x by z) and ceiling. The window is the front (+z) wall. */
export const ROOM_SIZE = { width: 4.4, back: -2.4, front: 1.9, height: 2.8 } as const;

/** The vault door sits in the Vault room's inner side wall, on the hallway's line. */
export const VAULT_DOOR = { x: HALL.endX, radius: 0.95, centreY: FLOOR_Y + 1.05 } as const;

/** The hub's hatch (where the camera flies in from outside). */
export const HATCH = { z: HUB.radius, centreY: FLOOR_Y + 1.2 } as const;

/** Vault opening timeline (seconds from when it starts). */
export const VAULT_OPENING = { unlock: 1.0, swing: 2.6, wave: 4.2, seated: 6.2 } as const;
