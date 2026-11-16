// The apps on each building's desktop (its modules, spec section 7).
// Only Mission Control's To-do is built; everything else is "later" or under construction.
import type { BuildingId } from "../api";

export type App = { id: string; name: string; ready: boolean };

const MISSION_CONTROL: readonly App[] = [
  { id: "todo", name: "To-do", ready: true },
  { id: "plan", name: "Daily plan", ready: false },
  { id: "review", name: "Weekly review", ready: false },
  { id: "projects", name: "Projects", ready: false },
];

export function appsFor(id: BuildingId): App[] {
  if (id === "planner") return MISSION_CONTROL.map((a) => ({ ...a }));
  return [{ id: "construction", name: "Under construction", ready: false }];
}
