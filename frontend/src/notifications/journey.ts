// The way from wherever you are to Mission Control's to-do app, one level at a
// time, so clicking a reminder in the ticker plays the normal flights (into the
// station, along the hallway, onto the screen) instead of jumping.
import type { View } from "../belt/levels";

const PLANNER: View = { level: "building", id: "planner" };
const SCREEN: View = { level: "screen", id: "planner" };

export function stepsToTask(view: View): View[] {
  if (view.level === "belt") return [PLANNER, SCREEN];
  if (view.level === "screen") {
    if (view.id === "planner") return [];
    return [{ level: "building", id: view.id }, ...stepsToTask({ level: "building", id: view.id })];
  }
  if (view.id === "planner") return [SCREEN];
  // The Vault is the other room in the station: through the hallways, no need to leave.
  if (view.id === "finance") return [PLANNER, SCREEN];
  return [{ level: "belt" }, PLANNER, SCREEN];
}
