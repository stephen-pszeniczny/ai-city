// Tests for the three levels (belt → building → screen) and their addresses. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import { back, otherStationRoom, parsePath, toPath, type View } from "../src/belt/levels.ts";

test("addresses map to views", () => {
  assert.deepEqual(parsePath("/"), { level: "belt" });
  assert.deepEqual(parsePath("/b/planner"), { level: "building", id: "planner" });
  assert.deepEqual(parsePath("/b/career/screen"), { level: "screen", id: "career" });
});

test("unknown buildings and odd paths land on the belt", () => {
  for (const p of ["/b/nope", "/b/nope/screen", "/b", "/b/", "/random", "/b/planner/extra", ""]) {
    assert.deepEqual(parsePath(p), { level: "belt" }, p);
  }
});

test("a trailing slash is tolerated", () => {
  assert.deepEqual(parsePath("/b/planner/"), { level: "building", id: "planner" });
  assert.deepEqual(parsePath("/b/planner/screen/"), { level: "screen", id: "planner" });
});

test("toPath and parsePath round-trip for every valid view", () => {
  for (const p of ["/", "/b/planner", "/b/library/screen"]) assert.equal(toPath(parsePath(p)), p);
});

test("back steps out one level at a time", () => {
  const screen: View = { level: "screen", id: "gym" };
  const building: View = { level: "building", id: "gym" };
  assert.deepEqual(back(screen), building);
  assert.deepEqual(back(building), { level: "belt" });
  assert.deepEqual(back({ level: "belt" }), { level: "belt" });
});

test("otherStationRoom pairs Mission Control and the Vault", () => {
  assert.equal(otherStationRoom("planner"), "finance");
  assert.equal(otherStationRoom("finance"), "planner");
  assert.equal(otherStationRoom("jobs"), null);
});
