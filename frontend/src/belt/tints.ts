// Each building's colour tint (labels, robot, desk). Station modules have fixed
// tints; asteroids take theirs from the orbit table.
import type { BuildingId } from "../api";
import { ASTEROIDS } from "./space/orbit.ts";

const STATION_TINTS = { planner: "#dfe6f5", finance: "#f2c14e" } as const;

export function tintOf(id: BuildingId): string {
  if (id === "planner" || id === "finance") return STATION_TINTS[id];
  return ASTEROIDS.find((a) => a.id === id)?.tint ?? "#ffffff";
}
