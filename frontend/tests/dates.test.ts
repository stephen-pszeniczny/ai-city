// Tests for the to-do list's date wording. Run: npm test (Node's built-in runner, no installs).
import assert from "node:assert/strict";
import { test } from "node:test";

import { localDateString, statusNotes } from "../src/todo/dates.ts";

type T = Parameters<typeof statusNotes>[0];

const task = (over: Partial<T>): T => ({
  status: "open",
  goal_date: null,
  stale: false,
  updated_at: "2026-11-15T15:00:00Z",
  completed_at: null,
  ...over,
});

// 3 PM local on Nov 15 (local time, so the tests mean the same thing in any time zone).
const now = new Date(2026, 10, 15, 15, 0, 0);

test("today is the local calendar date, not the UTC one", () => {
  // 11:30 PM local stays the same day even where UTC has already rolled over.
  assert.equal(localDateString(new Date(2026, 10, 15, 23, 30)), "2026-11-15");
  assert.equal(localDateString(new Date(2026, 0, 5, 0, 5)), "2026-01-05");
});

test("goal date before today is overdue", () => {
  assert.deepEqual(statusNotes(task({ goal_date: "2026-11-12" }), now), [
    { text: "Overdue · Nov 12", tone: "bad" },
  ]);
});

test("goal date today is due today", () => {
  assert.deepEqual(statusNotes(task({ goal_date: "2026-11-15" }), now), [
    { text: "Due today", tone: "accent" },
  ]);
});

test("future goal date shows the date; another year shows the year", () => {
  assert.deepEqual(statusNotes(task({ goal_date: "2026-12-01" }), now), [
    { text: "Due Dec 1", tone: "plain" },
  ]);
  assert.deepEqual(statusNotes(task({ goal_date: "2027-01-03" }), now), [
    { text: "Due Jan 3, 2027", tone: "plain" },
  ]);
});

test("goal date is never shifted by the time zone", () => {
  // Parsing "2026-12-01" as UTC midnight would show Nov 30 west of Greenwich.
  const [note] = statusNotes(task({ goal_date: "2026-12-01" }), now);
  assert.equal(note?.text, "Due Dec 1");
});

test("stale shows whole days since the last change, alongside any date note", () => {
  const notes = statusNotes(
    task({
      goal_date: "2026-12-01",
      stale: true,
      updated_at: new Date(2026, 10, 6, 12, 0).toISOString(),
    }),
    now,
  );
  assert.deepEqual(notes, [
    { text: "Due Dec 1", tone: "plain" },
    { text: "Stale · 9 days", tone: "warn" },
  ]);
});

test("stale wording follows the backend's flag, not its own count", () => {
  assert.deepEqual(
    statusNotes(task({ stale: false, updated_at: "2026-01-01T00:00:00Z" }), now),
    [],
  );
});

test("stale for exactly one day says 'day'", () => {
  const notes = statusNotes(
    task({ stale: true, updated_at: new Date(2026, 10, 14, 15, 0).toISOString() }),
    now,
  );
  assert.match(notes[0]?.text ?? "", /^Stale · 1 day$/);
});

test("done tasks are never overdue or stale; they show when they were done", () => {
  const done = task({
    status: "done",
    goal_date: "2026-11-01",
    stale: true,
    completed_at: new Date(2026, 10, 14, 18, 0).toISOString(),
  });
  assert.deepEqual(statusNotes(done, now), [{ text: "Done Nov 14", tone: "muted" }]);
});

test("archived tasks just say archived", () => {
  assert.deepEqual(statusNotes(task({ status: "archived", goal_date: "2026-11-01" }), now), [
    { text: "Archived", tone: "muted" },
  ]);
});

test("open task with no date and not stale has no note", () => {
  assert.deepEqual(statusNotes(task({}), now), []);
});
