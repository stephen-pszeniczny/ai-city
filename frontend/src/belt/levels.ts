// The three levels of the belt and the web address for each:
//   /                    the belt (level 1)
//   /b/<id>              inside a building, the robot at work (level 2)
//   /b/<id>/screen       zoomed into the robot's screen (level 3)
// The address is the single source of truth, so reloads and browser Back work.
import type { BuildingId } from "../api";

export type View =
  { level: "belt" } | { level: "building"; id: BuildingId } | { level: "screen"; id: BuildingId };

const IDS: readonly BuildingId[] = [
  "planner",
  "finance",
  "jobs",
  "career",
  "mail",
  "relationships",
  "projects",
  "gym",
  "library",
];
const isBuildingId = (s: string): s is BuildingId => (IDS as readonly string[]).includes(s);

/** Anything unknown lands on the belt. */
export function parsePath(path: string): View {
  const parts = path.split("/").filter(Boolean);
  if (parts.length === 0) return { level: "belt" };
  if (parts[0] !== "b" || !parts[1] || !isBuildingId(parts[1])) return { level: "belt" };
  if (parts.length === 2) return { level: "building", id: parts[1] };
  if (parts.length === 3 && parts[2] === "screen") return { level: "screen", id: parts[1] };
  return { level: "belt" };
}

export function toPath(view: View): string {
  if (view.level === "belt") return "/";
  return view.level === "building" ? `/b/${view.id}` : `/b/${view.id}/screen`;
}

/** One level out. */
export function back(view: View): View {
  if (view.level === "screen") return { level: "building", id: view.id };
  return { level: "belt" };
}

/** The other control room in the station (Mission Control ↔ the Vault), or null. */
export function otherStationRoom(id: BuildingId): BuildingId | null {
  if (id === "planner") return "finance";
  if (id === "finance") return "planner";
  return null;
}
