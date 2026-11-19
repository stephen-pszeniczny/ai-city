// Small live badges on building labels. Only real data: a building with nothing
// to report shows no badge (never made-up numbers).
import type { Task } from "../api";
import { localDateString } from "../todo/dates.ts";

type BadgeTask = Pick<Task, "status" | "goal_date" | "stale">;

/** Mission Control: "N overdue" first, then "Check-in due", then "N stale", otherwise nothing. */
export function plannerBadge(
  tasks: readonly BadgeTask[],
  now: Date = new Date(),
  checkinDue = false,
): string | null {
  const today = localDateString(now);
  const open = tasks.filter((t) => t.status === "open");
  const overdue = open.filter((t) => t.goal_date !== null && t.goal_date < today).length;
  if (overdue > 0) return `${overdue} overdue`;
  if (checkinDue) return "Check-in due";
  const stale = open.filter((t) => t.stale).length;
  if (stale > 0) return `${stale} stale`;
  return null;
}
