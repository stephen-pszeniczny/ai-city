// Helpers for the Sunday check-in: what each usual-event chip can do, which to-dos
// need attention before the week starts, and the events already added to the week.
// Days are "YYYY-MM-DD" strings, which sort like the dates they name.
import type { PlanBlock, PlanWeek, Task, UsualEvent } from "../api";
import { addDays, isPast } from "./week.ts";

export type ChipState = "add" | "added" | "past" | "pick-day";

/** "added": Steve already added it (same title, day and start); "past": its day has gone. */
export function chipState(event: UsualEvent, week: PlanWeek): ChipState {
  if (event.day === null) return "pick-day";
  const already = addedEvents(week).some(
    (b) => b.title === event.title && b.day === event.day && b.start === event.start,
  );
  if (already) return "added";
  if (isPast(event.day, week.today)) return "past";
  return "add";
}

export type Attention = { overdue: Task[]; dueThisWeek: Task[]; stale: Task[] };

/** Open to-dos worth a look before the week: each listed once, in the first group it fits. */
export function needsAttention(tasks: Task[], weekStart: string, today: string): Attention {
  const weekEnd = addDays(weekStart, 6);
  const byGoal = (a: Task, b: Task) =>
    (a.goal_date ?? "").localeCompare(b.goal_date ?? "") || a.id - b.id;
  const open = tasks.filter((t) => t.status === "open");
  const overdue = open.filter((t) => t.goal_date !== null && t.goal_date < today).sort(byGoal);
  const dueThisWeek = open
    .filter(
      (t) =>
        t.goal_date !== null &&
        t.goal_date >= today &&
        t.goal_date >= weekStart &&
        t.goal_date <= weekEnd,
    )
    .sort(byGoal);
  const listed = new Set([...overdue, ...dueThisWeek].map((t) => t.id));
  const stale = open.filter((t) => t.stale && !listed.has(t.id)).sort((a, b) => a.id - b.id);
  return { overdue, dueThisWeek, stale };
}

/** Blocks Steve added (events, side work, builds) across the week, by day then start. */
export function addedEvents(week: PlanWeek): PlanBlock[] {
  return week.days
    .flatMap((d) => d.blocks)
    .filter((b) => b.source === "added")
    .sort((a, b) => a.day.localeCompare(b.day) || a.start.localeCompare(b.start));
}
