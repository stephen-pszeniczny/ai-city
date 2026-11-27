// Tests for the counts each robot's monitor shows (never names, titles or amounts). Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import { liveStat } from "../src/interior/liveStat.ts";

test("Mission Control: overdue first, then due today, else all clear", () => {
  assert.deepEqual(liveStat("planner", { dueToday: 3, overdue: 0 }), {
    headline: "3 due today",
    gauge: null,
    style: "ring",
  });
  assert.equal(liveStat("planner", { dueToday: 1, overdue: 0 })?.headline, "1 due today");
  assert.equal(liveStat("planner", { dueToday: 2, overdue: 2 })?.headline, "2 overdue");
  assert.equal(liveStat("planner", { dueToday: 0, overdue: 0 })?.headline, "All clear");
});

test("Vault: the counts-only badge, or all in order", () => {
  assert.equal(liveStat("finance", { vaultBadge: "Statement due" })?.headline, "Statement due");
  assert.deepEqual(liveStat("finance", { vaultBadge: null }), {
    headline: "All in order",
    gauge: null,
    style: "bar",
  });
});

test("Opportunity Office: the badge passes through, or no checks due", () => {
  assert.equal(
    liveStat("jobs", { jobsBadge: "2 platforms to check" })?.headline,
    "2 platforms to check",
  );
  assert.deepEqual(liveStat("jobs", { jobsBadge: null }), {
    headline: "No checks due",
    gauge: null,
    style: "radar",
  });
});

test("unknown counts give a neutral screen, never a made-up number", () => {
  assert.equal(liveStat("planner", {}), null);
  assert.equal(liveStat("finance", {}), null);
  assert.equal(liveStat("jobs", {}), null);
});

test("unbuilt or other buildings have no live view", () => {
  assert.equal(liveStat("career", { dueToday: 3 }), null);
  assert.equal(liveStat("library", {}), null);
});
