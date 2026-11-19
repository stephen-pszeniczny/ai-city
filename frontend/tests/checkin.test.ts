// Tests for the Sunday check-in helpers. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { PlanBlock, PlanWeek, Task, UsualEvent } from "../src/api.ts";
import { addedEvents, chipState, needsAttention } from "../src/plan/checkin.ts";

const block = (over: Partial<PlanBlock>): PlanBlock => ({
  id: 1,
  day: "2026-12-03",
  start: "21:00",
  end: "22:00",
  title: "Hockey",
  kind: "event",
  source: "added",
  status: "planned",
  edited: false,
  ...over,
});

const week = (today: string, blocks: PlanBlock[] = []): PlanWeek => ({
  configured: true,
  week_start: "2026-11-30",
  today,
  exists: true,
  checked_in: false,
  grocery_day: null,
  days: [
    "2026-11-30",
    "2026-12-01",
    "2026-12-02",
    "2026-12-03",
    "2026-12-04",
    "2026-12-05",
    "2026-12-06",
  ].map((day) => ({ day, blocks: blocks.filter((b) => b.day === day) })),
});

const hockey: UsualEvent = {
  title: "Hockey",
  kind: "event",
  day: "2026-12-03",
  start: "21:00",
  end: "22:00",
};

test("chipState: add, added, past, pick-day", () => {
  assert.equal(chipState(hockey, week("2026-11-29")), "add");
  assert.equal(chipState(hockey, week("2026-11-29", [block({})])), "added");
  // Same title on another day or time doesn't count as added.
  assert.equal(chipState(hockey, week("2026-11-29", [block({ day: "2026-12-04" })])), "add");
  // A fixed block with the same name isn't one Steve added.
  assert.equal(chipState(hockey, week("2026-11-29", [block({ source: "settings" })])), "add");
  assert.equal(chipState(hockey, week("2026-12-04")), "past");
  assert.equal(chipState({ ...hockey, day: null }, week("2026-11-29")), "pick-day");
});

const task = (id: number, goal_date: string | null, over: Partial<Task> = {}): Task => ({
  id,
  title: `Task ${id}`,
  notes: "",
  category: "personal",
  goal_date,
  reminder_at: null,
  status: "open",
  created_at: "2026-11-15T15:00:00Z",
  updated_at: "2026-11-15T15:00:00Z",
  completed_at: null,
  stale: false,
  ...over,
});

test("needsAttention: overdue, due this week, stale; each task once; open only", () => {
  const tasks = [
    task(1, "2026-11-20"),
    task(2, "2026-12-02"),
    task(3, null, { stale: true }),
    task(4, "2026-11-25", { stale: true }), // overdue and stale: listed as overdue only
    task(5, "2026-12-10"), // after the week
    task(6, "2026-12-01", { status: "done" }),
    task(7, "2026-11-29"), // today: due, not overdue, but before the week
  ];
  const got = needsAttention(tasks, "2026-11-30", "2026-11-29");
  assert.deepEqual(
    [got.overdue.map((t) => t.id), got.dueThisWeek.map((t) => t.id), got.stale.map((t) => t.id)],
    [[1, 4], [2], [3]],
  );
});

test("addedEvents: only blocks Steve added, by day then start", () => {
  const w = week("2026-11-29", [
    block({ id: 3, day: "2026-12-04", start: "19:00" }),
    block({ id: 1, day: "2026-12-03", start: "21:00" }),
    block({ id: 2, day: "2026-12-03", start: "18:00" }),
    block({ id: 9, source: "settings", title: "Work" }),
  ]);
  assert.deepEqual(
    addedEvents(w).map((b) => b.id),
    [2, 1, 3],
  );
});
