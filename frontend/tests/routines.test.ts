// Tests for the routine card helpers. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { RoutineDay } from "../src/api.ts";
import { isShowing, localHHMM, progress } from "../src/plan/routines.ts";

const routine = (ticks: boolean[]): RoutineDay => ({
  id: "evening_prep",
  title: "Evening prep",
  shows_from: "19:00",
  remind_at: "21:30",
  items: ticks.map((ticked, n) => ({ name: `Item ${n}`, ticked })),
  done: ticks.filter(Boolean).length,
  total: ticks.length,
});

test("progress: whole percent of items ticked", () => {
  assert.deepEqual(progress(routine([false, false, false])), { done: 0, total: 3, percent: 0 });
  assert.deepEqual(progress(routine([true, true, false])), { done: 2, total: 3, percent: 67 });
  assert.deepEqual(progress(routine([true, true, true])), { done: 3, total: 3, percent: 100 });
  assert.deepEqual(progress(routine([])), { done: 0, total: 0, percent: 0 });
});

test("isShowing: from its start time", () => {
  assert.equal(isShowing(routine([false]), "18:59"), false);
  assert.equal(isShowing(routine([false]), "19:00"), true);
  assert.equal(isShowing(routine([false]), "23:30"), true);
});

test("localHHMM pads hours and minutes", () => {
  assert.equal(localHHMM(new Date(2026, 10, 29, 7, 5)), "07:05");
  assert.equal(localHHMM(new Date(2026, 10, 29, 21, 30)), "21:30");
});
