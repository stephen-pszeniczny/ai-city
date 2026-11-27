// Week helpers for the Daily plan: moving between weeks, day labels, overlaps,
// which to-dos show under a day, and which days can still be changed.
//
// Days are calendar days ("2026-11-25"), never moments: they're parsed as UTC
// midnight and only ever moved in whole days, so no time zone can shift them.
// "YYYY-MM-DD" and "HH:MM" strings sort the same way as what they name.
import type { PlanBlock, Task } from "../api";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Gym can be marked done or skipped for this many days back (the server's rule too). */
export const GYM_DAYS_BACK = 7;

const toUtc = (day: string): Date => new Date(`${day}T00:00:00Z`);

/** The day `by` days after `day` (negative goes back). */
export function addDays(day: string, by: number): string {
  return new Date(toUtc(day).getTime() + by * DAY_MS).toISOString().slice(0, 10);
}

/** The Monday `by` weeks after this one. */
export const shiftWeek = (weekStart: string, by: number): string => addDays(weekStart, by * 7);

/** "Wed 25". */
export function dayLabel(day: string): string {
  const d = toUtc(day);
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}`;
}

/** What a day's tile in the week strip shows: weekday, date and a short block count. */
export function dayTile(
  day: string,
  blocks: number,
): { weekday: string; date: string; count: string } {
  const d = toUtc(day);
  const count = blocks === 0 ? "Free" : `${blocks} block${blocks === 1 ? "" : "s"}`;
  return { weekday: WEEKDAYS[d.getUTCDay()] ?? "", date: String(d.getUTCDate()), count };
}

/** IDs of blocks whose times overlap another block's (end = start is just touching). */
export function overlapping(blocks: PlanBlock[]): Set<number> {
  const ids = new Set<number>();
  for (const a of blocks) {
    for (const b of blocks) {
      if (a.id !== b.id && a.start < b.end && b.start < a.end) ids.add(a.id);
    }
  }
  return ids;
}

/** Open to-dos due on `day`; under today also the overdue ones. Oldest goal date first. */
export function todosFor(tasks: Task[], day: string, today: string): Task[] {
  return tasks
    .filter(
      (t) =>
        t.status === "open" &&
        t.goal_date !== null &&
        (t.goal_date === day || (day === today && t.goal_date < today)),
    )
    .sort((a, b) =>
      a.goal_date! < b.goal_date! ? -1 : a.goal_date! > b.goal_date! ? 1 : a.id - b.id,
    );
}

export const isPast = (day: string, today: string): boolean => day < today;

/** Gym can be marked on its day and for GYM_DAYS_BACK days after, never ahead. */
export const canMarkGym = (day: string, today: string): boolean =>
  day <= today && day >= addDays(today, -GYM_DAYS_BACK);
