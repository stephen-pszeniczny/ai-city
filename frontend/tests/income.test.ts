// Tests for the Income screen's helpers. Run: npm test. Values are invented.
import assert from "node:assert/strict";
import { test } from "node:test";

import { formatMonth, goalProgress, stackSegments } from "../src/vault/income.ts";

test("goal progress shows the real percent", () => {
  assert.deepEqual(goalProgress(375000, 750000), { percent: 50, fill: 0.5, label: "50% of goal" });
});

test("over the goal: the bar is full, the label says how far over", () => {
  assert.deepEqual(goalProgress(900000, 750000), { percent: 120, fill: 1, label: "120% of goal" });
});

test("no goal set: nothing to measure against", () => {
  assert.deepEqual(goalProgress(1000, 0), { percent: 0, fill: 0, label: "No goal set" });
});

test("stacked bar pieces sit on top of each other and share the height", () => {
  const segs = stackSegments(
    [
      { key: "main_job", cents: 300000 },
      { key: "platform_a", cents: 100000 },
    ],
    800000, // the tallest thing on the chart (goal or biggest month)
    200,
  );
  assert.deepEqual(segs, [
    { key: "main_job", y: 125, h: 75 },
    { key: "platform_a", y: 100, h: 25 },
  ]);
});

test("months read as short names", () => {
  assert.equal(formatMonth("2026-11"), "Nov");
  assert.equal(formatMonth("2027-01"), "Jan");
});
