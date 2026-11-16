// Tests for the history timeline wording. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import { describeEvent, formatMoment, formatReminder } from "../src/todo/history.ts";

const now = new Date(2026, 10, 15, 15, 0);
// A UTC timestamp for a local moment, so tests mean the same in every time zone.
const at = (y: number, mo: number, d: number, h: number, mi: number) =>
  new Date(y, mo - 1, d, h, mi).toISOString().replace(/\.\d{3}Z$/, "Z");

test("moments show local date and 12-hour time; another year adds the year", () => {
  assert.equal(formatMoment(at(2026, 11, 15, 18, 5), now), "Nov 15, 6:05 PM");
  assert.equal(formatMoment(at(2026, 11, 15, 0, 30), now), "Nov 15, 12:30 AM");
  assert.equal(formatMoment(at(2026, 11, 15, 12, 0), now), "Nov 15, 12:00 PM");
  assert.equal(formatMoment(at(2025, 12, 31, 9, 0), now), "Dec 31, 2025, 9:00 AM");
});

test("reminders are local wall-clock times and are never shifted", () => {
  assert.equal(formatReminder("2026-11-20T09:00", now), "Nov 20, 9:00 AM");
  assert.equal(formatReminder("2027-01-02T21:45", now), "Jan 2, 2027, 9:45 PM");
});

test("created lists what was set, skipping the title", () => {
  const e = describeEvent(
    {
      at: at(2026, 11, 15, 9, 0),
      kind: "created",
      changes: {
        title: [null, "Book dentist"],
        category: [null, "personal"],
        goal_date: [null, "2026-12-01"],
        reminder_at: [null, "2026-11-30T09:00"],
        notes: [null, "call first"],
      },
    },
    now,
  );
  assert.equal(e.label, "Created");
  assert.deepEqual(e.details, [
    "Category: Personal",
    "Goal date: Dec 1",
    "Reminder: Nov 30, 9:00 AM",
    "Notes added",
  ]);
});

test("edits show old → new; cleared values say none; notes just say changed", () => {
  const e = describeEvent(
    {
      at: at(2026, 11, 15, 9, 0),
      kind: "edited",
      changes: {
        title: ["Book dentist", "Book dentist and eye exam"],
        goal_date: ["2026-12-01", null],
        category: ["personal", "city"],
        notes: ["a", "b"],
      },
    },
    now,
  );
  assert.equal(e.label, "Edited");
  assert.deepEqual(e.details, [
    "Title: Book dentist → Book dentist and eye exam",
    "Category: Personal → Belt",
    "Goal date: Dec 1 → none",
    "Notes changed",
  ]);
});

test("status changes are one word; reopening from archive says so", () => {
  const ev = (kind: "completed" | "reopened" | "archived", from: string, to: string) =>
    describeEvent({ at: at(2026, 11, 15, 9, 0), kind, changes: { status: [from, to] } }, now);
  assert.deepEqual(ev("completed", "open", "done"), {
    label: "Completed",
    when: "Nov 15, 9:00 AM",
    details: [],
  });
  assert.equal(ev("reopened", "done", "open").label, "Reopened");
  assert.equal(ev("reopened", "archived", "open").label, "Restored from archive");
  assert.equal(ev("archived", "open", "archived").label, "Archived");
});

test("notes being cleared says removed", () => {
  const e = describeEvent(
    { at: at(2026, 11, 15, 9, 0), kind: "edited", changes: { notes: ["old", ""] } },
    now,
  );
  assert.deepEqual(e.details, ["Notes removed"]);
});
