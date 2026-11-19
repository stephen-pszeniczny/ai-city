// Tests for building badges on the belt. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import { plannerBadge } from "../src/belt/badges.ts";
import { BUILT } from "../src/belt/built.ts";

type T = Parameters<typeof plannerBadge>[0][number];
const now = new Date(2026, 10, 15, 21, 30); // 9:30 PM local, Nov 15

const task = (over: Partial<T>): T => ({
  status: "open",
  goal_date: null,
  stale: false,
  ...over,
});

test("overdue wins: 2 overdue + 1 stale says 2 overdue", () => {
  const tasks = [
    task({ goal_date: "2026-11-10" }),
    task({ goal_date: "2026-11-14" }),
    task({ stale: true }),
  ];
  assert.equal(plannerBadge(tasks, now), "2 overdue");
});

test("no overdue: 3 stale says 3 stale", () => {
  assert.equal(
    plannerBadge([task({ stale: true }), task({ stale: true }), task({ stale: true })], now),
    "3 stale",
  );
});

test("nothing to flag shows no badge", () => {
  assert.equal(plannerBadge([task({}), task({ goal_date: "2026-12-01" })], now), null);
  assert.equal(plannerBadge([], now), null);
});

test("due today is not overdue", () => {
  assert.equal(plannerBadge([task({ goal_date: "2026-11-15" })], now), null);
});

test("done and archived tasks never count", () => {
  const tasks = [
    task({ status: "done", goal_date: "2026-11-01", stale: true }),
    task({ status: "archived", goal_date: "2026-11-01", stale: true }),
  ];
  assert.equal(plannerBadge(tasks, now), null);
});

test("uses the local date, not UTC (9:30 PM in the evening is still today)", () => {
  // In UTC it's already Nov 16; a UTC 'today' would wrongly call Nov 15 overdue.
  assert.equal(plannerBadge([task({ goal_date: "2026-11-15" })], now), null);
});

test("Mission Control and the Vault are built; everything else is under construction", () => {
  assert.deepEqual([...BUILT], ["planner", "finance"]);
});
