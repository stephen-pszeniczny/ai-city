// The module growth tests' stand-in for the station: the real one, built without a browser.
import * as THREE from "three";

import { createInteriorGrowth, createModuleGrowth } from "../src/belt/growth/applyGrowth.ts";
import { createStation } from "../src/belt/station.ts";
import { tintOf } from "../src/belt/tints.ts";
import { MODULE_X, ROOM_OFFSET } from "../src/interior/stationLayout.ts";
import { stubKit } from "./growthStub.ts";

export type Module = "planner" | "finance";
export const MODULES: Module[] = ["planner", "finance"];

/** The whole station with both modules' outsides able to grow. */
export function makeStation() {
  const { kit, kept } = stubKit();
  const station = createStation(kit);
  const growth = {
    planner: createModuleGrowth("planner", station, kit),
    finance: createModuleGrowth("finance", station, kit),
  };
  return { kit, kept, station, growth };
}

/** One control room's growing pieces, placed where ControlStation and VaultDoor put them. */
export function makeRoom(id: Module) {
  const { kit, kept } = stubKit();
  const interior = createInteriorGrowth(id, tintOf(id), kit);
  const room = new THREE.Group();
  room.position.set(MODULE_X[id], 0, 0).add(ROOM_OFFSET);
  room.add(interior.pieces);
  return { kit, kept, interior, room };
}
