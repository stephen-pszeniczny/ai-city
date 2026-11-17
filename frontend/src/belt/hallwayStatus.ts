// What the status screens along Mission Control's hallway show: each asteroid
// building's state, plus a one-line summary of the to-do list. Counts and
// status only, never amounts or anything personal.
import type { Building, BuildingId, Task } from "../api";
import { localDateString } from "../todo/dates.ts";

type SummaryTask = Pick<Task, "status" | "goal_date" | "stale">;
export type HallwayRow = { id: BuildingId; name: string; text: string };

/** The station's own modules aren't listed (they're the station itself). */
const STATION: readonly BuildingId[] = ["planner", "finance"];

function rows(buildings: readonly Building[], built: ReadonlySet<BuildingId>): HallwayRow[] {
  return buildings
    .filter((b) => !STATION.includes(b.id))
    .map((b) => ({
      id: b.id,
      name: b.name,
      text: built.has(b.id) ? "Ready" : "Under construction",
    }));
}

/** "N overdue · M open", "M open" or "Nothing open". */
function missionSummary(tasks: readonly SummaryTask[], now: Date = new Date()): string {
  const open = tasks.filter((t) => t.status === "open");
  if (open.length === 0) return "Nothing open";
  const today = localDateString(now);
  const overdue = open.filter((t) => t.goal_date !== null && t.goal_date < today).length;
  return overdue > 0 ? `${overdue} overdue · ${open.length} open` : `${open.length} open`;
}

export const hallwayStatus = Object.assign(rows, { missionSummary });
