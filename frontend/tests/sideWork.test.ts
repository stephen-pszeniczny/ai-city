// Tests for the Side work screen's display helpers. Run: npm test.
// Every amount and date is invented.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatCad,
  formatDifference,
  formatMoney,
  formatWindow,
  hoursProblem,
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

test("hours match the engine's rule: more than 0, at most 168, up to 2 decimals", () => {
  for (const ok of ["1", "1.5", "0.25", "168", " 2 ", ""]) assert.equal(hoursProblem(ok), null, ok);
  for (const bad of ["0", "-2", "168.01", "12.345", "1:30", "abc"]) {
    assert.notEqual(hoursProblem(bad), null, bad);
  }
});
