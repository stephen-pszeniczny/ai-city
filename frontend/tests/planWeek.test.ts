// Tests for the Daily plan's week helpers. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { PlanBlock, Task } from "../src/api.ts";
import {
  canMarkGym,
  dayLabel,
  isPast,
  overlapping,
  shiftWeek,
  todosFor,
} from "../src/plan/week.ts";

const block = (id: number, start: string, end: string): PlanBlock => ({
  id,
  day: "2026-11-25",
  start,
  end,
  title: `Block ${id}`,
  kind: "event",
  source: "added",
  status: "planned",
  edited: false,
});

const task = (id: number, goal_date: string | null, status: Task["status"] = "open"): Task => ({
  id,
  title: `Task ${id}`,
  notes: "",
  category: "personal",
  goal_date,
  reminder_at: null,
  status,
  created_at: "2026-11-15T15:00:00Z",
  updated_at: "2026-11-15T15:00:00Z",
  completed_at: status === "done" ? "2026-11-16T15:00:00Z" : null,
  stale: false,
});

test("shiftWeek moves by whole weeks, across month and year ends", () => {
  assert.equal(shiftWeek("2026-11-23", 1), "2026-11-30");
  assert.equal(shiftWeek("2026-11-30", 1), "2026-12-07");
  assert.equal(shiftWeek("2026-11-23", -1), "2026-11-16");
  assert.equal(shiftWeek("2026-12-28", 1), "2027-01-04");
});

test("dayLabel is a short weekday and the day of the month", () => {
  assert.equal(dayLabel("2026-11-25"), "Wed 25");
  assert.equal(dayLabel("2026-11-29"), "Sun 29");
  assert.equal(dayLabel("2026-12-01"), "Tue 1");
});

test("overlapping finds blocks whose times overlap; touching isn't overlapping", () => {
  assert.deepEqual(
    overlapping([
      block(1, "10:00", "11:00"),
      block(2, "10:30", "12:00"),
      block(3, "12:00", "13:00"),
    ]),
    new Set([1, 2]),
  );
  assert.deepEqual(
    overlapping([block(1, "10:00", "11:00"), block(2, "11:00", "12:00")]),
    new Set(),
  );
  assert.deepEqual(
    overlapping([block(1, "09:00", "17:00"), block(2, "12:00", "13:00")]),
    new Set([1, 2]),
  );
});

test("todosFor: due that day; on today also overdue, oldest first; done left out", () => {
  const tasks = [
    task(1, "2026-11-25"),
    task(2, "2026-11-20"),
    task(3, "2026-11-22"),
    task(4, "2026-11-26"),
    task(5, null),
    task(6, "2026-11-25", "done"),
    task(7, "2026-11-25", "archived"),
  ];
  assert.deepEqual(
    todosFor(tasks, "2026-11-25", "2026-11-25").map((t) => t.id),
    [2, 3, 1],
  );
  assert.deepEqual(
    todosFor(tasks, "2026-11-26", "2026-11-25").map((t) => t.id),
    [4],
  );
  // Overdue only shows under today, not under another day.
  assert.deepEqual(
    todosFor(tasks, "2026-11-24", "2026-11-25").map((t) => t.id),
    [],
  );
});

test("isPast compares calendar days", () => {
  assert.equal(isPast("2026-11-24", "2026-11-25"), true);
  assert.equal(isPast("2026-11-25", "2026-11-25"), false);
  assert.equal(isPast("2026-11-26", "2026-11-25"), false);
});

test("canMarkGym: today and up to 7 days back, never ahead", () => {
  assert.equal(canMarkGym("2026-11-25", "2026-11-25"), true);
  assert.equal(canMarkGym("2026-11-18", "2026-11-25"), true);
  assert.equal(canMarkGym("2026-11-17", "2026-11-25"), false);
  assert.equal(canMarkGym("2026-11-26", "2026-11-25"), false);
  assert.equal(canMarkGym("2026-11-30", "2026-12-02"), true); // across a month end
});
