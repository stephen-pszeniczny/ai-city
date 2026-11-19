// Tests for the Income screen's helpers. Run: npm test. Values are invented.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatMonth,
  goalProgress,
  linkNote,
  matchChip,
  monthLines,
  payStatus,
  stackSegments,
  wholeDollars,
} from "../src/vault/income.ts";

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

test("main-job pay says whether the statement has confirmed it", () => {
  assert.equal(payStatus(true), "✓ confirmed by statement");
  assert.equal(payStatus(false), "not yet confirmed");
});

test("linking: nothing to say when the statement matches what was typed", () => {
  assert.equal(linkNote(210000, 210000), null);
});

test("linking: a different statement amount is shown, and it wins", () => {
  assert.equal(
    linkNote(210050, 209900),
    "The statement says $2,100.50; you typed $2,099.00. The statement's amount will be used.",
  );
});

test("review chip: an exact match, a near one to check, or nothing", () => {
  const pay = { paid_on: "2026-03-20", net_cents: 210000 };
  assert.equal(
    matchChip({ kind: "link", pay_id: 7, pay, check_amount: false }),
    "Matches the pay you typed in (Mar 20, $2,100.00)",
  );
  assert.equal(
    matchChip({ kind: "link", pay_id: 7, pay, check_amount: true }),
    "Might be the pay you typed in (Mar 20, $2,100.00): check the amount",
  );
  assert.equal(matchChip({ kind: "new", pay_id: null, pay: null, check_amount: false }), null);
});

test("wholeDollars rounds to whole dollars", () => {
  assert.equal(wholeDollars(500000), "$5,000");
  assert.equal(wholeDollars(123450), "$1,235");
  assert.equal(wholeDollars(49), "$0");
});

test("monthLines drops empty sources", () => {
  assert.deepEqual(
    monthLines([
      { key: "main_job", cents: 500000 },
      { key: "platform_a", cents: 0 },
      { key: "extra", cents: 7550 },
    ]),
    [
      { key: "main_job", text: "$5,000" },
      { key: "extra", text: "$76" },
    ],
  );
  assert.deepEqual(monthLines([]), []);
});

test("monthLines never shows a $0 line for a few cents", () => {
  assert.deepEqual(
    monthLines([
      { key: "main_job", cents: 500000 },
      { key: "extra", cents: 30 },
    ]),
    [{ key: "main_job", text: "$5,000" }],
  );
});
