// Date wording for task rows: overdue, due today, due <date>, stale, done.
//
// Two traps this file avoids:
//  - "Today" is the local calendar date. new Date().toISOString() is UTC and
//    would make tasks overdue in the evening anywhere west of UTC.
//  - A goal date like "2026-12-01" is a calendar day, not a moment. Parsing it
//    with new Date() treats it as UTC midnight, which shows Nov 30 west of UTC.
import type { Task } from "../api";

export type Tone = "bad" | "warn" | "accent" | "plain" | "muted";
export type Note = { text: string; tone: Tone };

type NoteInput = Pick<Task, "status" | "goal_date" | "stale" | "updated_at" | "completed_at">;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The local calendar date as "YYYY-MM-DD". */
export function localDateString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The status notes for one row, most important first. Empty when there's nothing to say. */
export function statusNotes(task: NoteInput, now: Date = new Date()): Note[] {
  if (task.status === "archived") return [{ text: "Archived", tone: "muted" }];
  if (task.status === "done") {
    if (!task.completed_at) return [{ text: "Done", tone: "muted" }];
    const done = new Date(task.completed_at);
    return [{ text: `Done ${shortDate(localDateString(done), now)}`, tone: "muted" }];
  }

  const notes: Note[] = [];
  if (task.goal_date) {
    const today = localDateString(now);
    // "YYYY-MM-DD" strings sort the same way as the dates they name.
    if (task.goal_date < today) {
      notes.push({ text: `Overdue · ${shortDate(task.goal_date, now)}`, tone: "bad" });
    } else if (task.goal_date === today) {
      notes.push({ text: "Due today", tone: "accent" });
    } else {
      notes.push({ text: `Due ${shortDate(task.goal_date, now)}`, tone: "plain" });
    }
  }
  // The backend decides what counts as stale (settings: tasks.stale_after_days);
  // this only words it.
  if (task.stale) {
    const days = Math.floor((now.getTime() - new Date(task.updated_at).getTime()) / DAY_MS);
    notes.push({ text: `Stale · ${days} ${days === 1 ? "day" : "days"}`, tone: "warn" });
  }
  return notes;
}

/** "Dec 1", or "Jan 3, 2027" when it isn't this year. Takes a calendar date "YYYY-MM-DD". */
export function shortDate(calendarDate: string, now: Date = new Date()): string {
  const [y, m, d] = calendarDate.split("-").map(Number) as [number, number, number];
  // Built from its parts in local time, so no time zone can shift the day.
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(y === now.getFullYear() ? {} : { year: "numeric" }),
  });
}
