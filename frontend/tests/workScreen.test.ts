// Tests for what each robot's screen shows while it works, and the near/far
// detail switch. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import { LOOK } from "../src/belt/look.ts";
import { detailFor } from "../src/belt/lod.ts";
import { workScreen } from "../src/interior/workScreen.ts";

const TASKS = [{ title: "Water the plants" }, { title: "Fix bike tyre" }];

test('planner tabs include "To-do" and use the real task titles', () => {
  // Find a tick whose active tab is To-do.
  for (let tick = 0; tick < 40; tick++) {
    const s = workScreen("planner", true, tick, TASKS);
    assert.ok(s.tabs.includes("To-do"));
    if (s.tabs[s.active] === "To-do") {
      assert.deepEqual(s.list, ["Water the plants", "Fix bike tyre"]);
      return;
    }
  }
  assert.fail("To-do tab never became active");
});

test('unbuilt buildings say "Setting up" and stay under construction', () => {
  const s = workScreen("jobs", false, 3);
  assert.equal(s.construction, true);
  assert.ok(s.tabs.some((t) => t.startsWith("Setting up")));
});

test("same tick same screen; next tick changes progress or log", () => {
  const a = workScreen("library", false, 5);
  assert.deepEqual(workScreen("library", false, 5), a);
  const b = workScreen("library", false, 6);
  assert.ok(
    JSON.stringify(a.progress) !== JSON.stringify(b.progress) ||
      JSON.stringify(a.log) !== JSON.stringify(b.log),
  );
});

test("log lines are generic", () => {
  for (const id of ["planner", "finance", "jobs", "mail", "career"] as const) {
    for (let tick = 0; tick < 30; tick++) {
      for (const line of workScreen(id, id === "planner", tick).log) {
        assert.doesNotMatch(line, /\$\s?\d|\d\s?\$|@/, line);
      }
    }
  }
});

test("progress values stay between 0 and 1", () => {
  for (let tick = 0; tick < 100; tick++) {
    for (const v of workScreen("gym", false, tick).progress) assert.ok(v >= 0 && v <= 1);
  }
});

test("detailFor switches at the far distance", () => {
  assert.equal(detailFor(5), "near");
  assert.equal(detailFor(LOOK.farDetailDistance + 1), "far");
});
