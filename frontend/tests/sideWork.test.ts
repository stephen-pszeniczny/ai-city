// Tests for the Side work screen's display helpers. Run: npm test.
// Every amount and date is invented.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatCad,
  formatDifference,
  formatMoney,
  formatWindow,
  combineTime,
  formatTime,
  statusLabel,
} from "../src/vault/sideWork.ts";

test("CAD amounts have a dollar sign, thousands commas and cents", () => {
  assert.equal(formatCad(123450), "$1,234.50");
  assert.equal(formatCad(5), "$0.05");
  assert.equal(formatCad(0), "$0.00");
});

test("an unknown CAD amount shows as rate pending", () => {
  assert.equal(formatCad(null), "rate pending");
});

test("USD amounts are marked as US dollars", () => {
  assert.equal(formatMoney(4000, "USD"), "US$40.00");
  assert.equal(formatMoney(4000, "CAD"), "$40.00");
});

test("the arrival window reads as a short range", () => {
  assert.equal(formatWindow(["2026-03-21", "2026-03-23"]), "lands Mar 21–23");
  assert.equal(formatWindow(["2026-03-30", "2026-04-01"]), "lands Mar 30 – Apr 1");
  assert.equal(formatWindow(["2026-03-21", "2026-03-21"]), "lands Mar 21");
});

test("the arrival window ignores the Mac's time zone", () => {
  // Parsed as calendar days, never as midnight UTC (which shows the day before anywhere west of UTC).
  assert.equal(formatWindow(["2026-01-01", "2026-01-02"]), "lands Jan 1–2");
});

test("the difference says short, extra or in full", () => {
  assert.equal(formatDifference(-69), "$0.69 short");
  assert.equal(formatDifference(150), "$1.50 extra");
  assert.equal(formatDifference(0), "Paid in full");
  assert.equal(formatDifference(null), "");
});

test("status labels", () => {
  assert.equal(statusLabel("waiting"), "Waiting");
  assert.equal(statusLabel("overdue"), "Overdue");
  assert.equal(statusLabel("paid"), "Paid");
  assert.equal(statusLabel("no_schedule"), "No pay schedule");
});

test("hours and minutes combine into the decimal hours the engine stores", () => {
  assert.deepEqual(combineTime("", "45"), { value: "0.75", problem: null });
  assert.deepEqual(combineTime("2", ""), { value: "2", problem: null });
  assert.deepEqual(combineTime("1", "10"), { value: "1.17", problem: null });
  assert.deepEqual(combineTime("0", "20"), { value: "0.33", problem: null });
  assert.deepEqual(combineTime(" 1 ", " 30 "), { value: "1.5", problem: null });
});

test("both boxes blank means hours unknown, which is allowed", () => {
  assert.deepEqual(combineTime("", ""), { value: null, problem: null });
});

test("bad time gives a short problem and no value", () => {
  for (const [h, m] of [
    ["1", "60"],
    ["-1", "0"],
    ["1.5", ""],
    ["", "7.5"],
    ["abc", ""],
    ["0", "0"],
    ["168", "1"],
    ["", "0"],
  ]) {
    const r = combineTime(h!, m!);
    assert.equal(r.value, null, `${h} h ${m} min`);
    assert.notEqual(r.problem, null, `${h} h ${m} min`);
  }
  assert.deepEqual(combineTime("168", ""), { value: "168", problem: null });
});

test("saved hours read as hours and minutes", () => {
  assert.equal(formatTime("1.17"), "1 h 10 min");
  assert.equal(formatTime("0.75"), "45 min");
  assert.equal(formatTime("2"), "2 h");
  assert.equal(formatTime(null), "time ?");
});
