// Tests for placing a day's blocks on the check-in's mini timeline. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import { timelineSegments } from "../src/plan/timeline.ts";

const b = (start: string, end: string, kind = "work") => ({ start, end, kind, title: "x" });

test("a block is placed by its share of the 06:00–24:00 day", () => {
  const [s] = timelineSegments([b("09:00", "12:00")]);
  assert.equal(s?.top, "16.67%");
  assert.equal(s?.height, "16.67%");
  assert.equal(s?.kind, "work");
});

test("blocks before 06:00 or past midnight are clipped to the day", () => {
  const [early] = timelineSegments([b("05:00", "07:00")]);
  assert.equal(early?.top, "0%");
  assert.equal(early?.height, "5.56%");
});

test("a block entirely outside the day is left out", () => {
  assert.deepEqual(timelineSegments([b("04:00", "05:30")]), []);
});

test("the hover label keeps the title and times", () => {
  assert.equal(
    timelineSegments([{ ...b("12:00", "13:00", "gym"), title: "Gym" }])[0]?.label,
    "Gym 12:00–13:00",
  );
});
