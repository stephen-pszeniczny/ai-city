// Wording for a task's history timeline: one entry per change, oldest first.
//
// Imports name the .ts file because Node's test runner (npm test) loads these
// files directly and needs the full name.
import type { Category, HistoryEvent } from "../api";
import { categoryLabel } from "./categories.ts";
import { shortDate } from "./dates.ts";

export type EventText = { label: string; when: string; details: string[] };

const FIELD_NAMES: Record<string, string> = {
  title: "Title",
  category: "Category",
  goal_date: "Goal date",
  reminder_at: "Reminder",
};
const FIELD_ORDER = ["title", "category", "goal_date", "reminder_at", "notes"];

export function describeEvent(event: HistoryEvent, now: Date = new Date()): EventText {
  const when = formatMoment(event.at, now);
  switch (event.kind) {
    case "created":
      return { label: "Created", when, details: fieldLines(event.changes, now, "created") };
    case "edited":
      return { label: "Edited", when, details: fieldLines(event.changes, now, "edited") };
    case "completed":
      return { label: "Completed", when, details: [] };
    case "reopened": {
      const from = event.changes.status?.[0];
      return {
        label: from === "archived" ? "Restored from archive" : "Reopened",
        when,
        details: [],
      };
    }
    case "archived":
      return { label: "Archived", when, details: [] };
  }
}

function fieldLines(
  changes: HistoryEvent["changes"],
  now: Date,
  kind: "created" | "edited",
): string[] {
  const lines: string[] = [];
  // The backend's field order isn't guaranteed; show them in a fixed order.
  for (const field of FIELD_ORDER) {
    const change = changes[field];
    if (!change) continue;
    const [before, after] = change;
    if (field === "notes") {
      // Notes can be long and personal; the timeline only says what happened.
      lines.push(kind === "created" ? "Notes added" : after ? "Notes changed" : "Notes removed");
      continue;
    }
    if (kind === "created" && field === "title") continue; // the title is already on screen
    const name = FIELD_NAMES[field] ?? field;
    const show = (v: unknown) => formatValue(field, v, now);
    lines.push(
      kind === "created" ? `${name}: ${show(after)}` : `${name}: ${show(before)} → ${show(after)}`,
    );
  }
  return lines;
}

function formatValue(field: string, value: unknown, now: Date): string {
  if (value === null || value === undefined || value === "") return "none";
  const text = String(value);
  if (field === "category") return categoryLabel(text as Category);
  if (field === "goal_date") return shortDate(text, now);
  if (field === "reminder_at") return formatReminder(text, now);
  return text;
}

/** A UTC timestamp from the backend, shown in local time: "Nov 15, 6:05 PM". */
export function formatMoment(utc: string, now: Date = new Date()): string {
  const d = new Date(utc);
  return dateAndTime(
    d.getFullYear(),
    d.getMonth() + 1,
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    now,
  );
}

/** A reminder is a local wall-clock time ("2026-11-20T09:00"); never shifted. */
export function formatReminder(local: string, now: Date = new Date()): string {
  const [date = "", time = ""] = local.split("T");
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  return dateAndTime(y, mo, d, h, mi, now);
}

function dateAndTime(y: number, mo: number, d: number, h: number, mi: number, now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  // Written by hand: the browser's own time format uses a special space before
  // AM/PM that varies between versions.
  const time = `${h % 12 || 12}:${pad(mi)} ${h < 12 ? "AM" : "PM"}`;
  return `${shortDate(`${y}-${pad(mo)}-${pad(d)}`, now)}, ${time}`;
}
