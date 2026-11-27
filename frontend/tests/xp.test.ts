// Tests for Belt XP's display helpers and its two saving calls. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import { markCelebrated, markXpSeen, type BeltXp, type BuildingXp } from "../src/api.ts";
import {
  barFraction,
  beltBarFraction,
  formatXp,
  levelToMark,
  showsPlusOne,
} from "../src/belt/xp.ts";

const building = (over: Partial<BuildingXp>): BuildingXp => ({
  id: "planner",
  earning: true,
  xp: 100,
  level: 3,
  level_start_xp: 100,
  next_level_xp: 200,
  tier: 0,
  seen_level: 3,
  celebrated_tier: 0,
  upgrade_waiting: false,
  ...over,
});

test("the bar fills from the level's start to the next level", () => {
  assert.equal(barFraction(building({ xp: 100 })), 0);
  assert.equal(barFraction(building({ xp: 150 })), 0.5);
});

test("the bar stays between empty and full", () => {
  assert.equal(barFraction(building({ xp: 40 })), 0); // under the level after an undo
  assert.equal(barFraction(building({ xp: 260 })), 1);
});

test("the top level is a full bar, even with XP under it", () => {
  const top = { level: 100, level_start_xp: 17500, next_level_xp: 17500 };
  assert.equal(barFraction(building({ ...top, xp: 17500 })), 1);
  assert.equal(barFraction(building({ ...top, xp: 900 })), 1);
});

test("a building not earning yet has an empty bar", () => {
  const idle = { earning: false, xp: 0, level: 0, level_start_xp: 0, next_level_xp: 0 };
  assert.equal(barFraction(building(idle)), 0);
});

test("plus one shows only for a level gained since the last look", () => {
  assert.equal(showsPlusOne(4, 3), true);
  assert.equal(showsPlusOne(3, 3), false);
  assert.equal(showsPlusOne(2, 3), false);
  assert.equal(showsPlusOne(3, 0), false); // the first-ever view doesn't pop
});

const belt = (over: Partial<BeltXp>): BeltXp => ({
  level: 7,
  progress: 0.7,
  total_xp: 1840,
  seen_level: 7,
  ...over,
});

test("the belt bar shows progress, kept between empty and full", () => {
  assert.equal(beltBarFraction(belt({})), 0.7);
  assert.equal(beltBarFraction(belt({ progress: -0.2 })), 0);
  assert.equal(beltBarFraction(belt({ progress: 1.4 })), 1);
});

test("at belt level 100 the bar is full", () => {
  assert.equal(beltBarFraction(belt({ level: 100, progress: 0 })), 1);
});

test("a level above the last one seen is saved, the first-ever look included", () => {
  assert.equal(levelToMark(belt({ level: 8, seen_level: 7 })), 8);
  // No pop on the first look, but it must be saved or no later level could ever pop.
  assert.equal(levelToMark(belt({ level: 1, seen_level: 0 })), 1);
});

test("nothing is saved for a level already seen, or one lost to an undo", () => {
  assert.equal(levelToMark(belt({ level: 7, seen_level: 7 })), null);
  assert.equal(levelToMark(belt({ level: 6, seen_level: 7 })), null);
});

test("XP is written with thousands separators", () => {
  assert.equal(formatXp(1840), "1,840");
  assert.equal(formatXp(0), "0");
});

test("saving what the page showed accepts the engine's empty 204 answer", async (t) => {
  const sent: unknown[] = [];
  t.mock.method(globalThis, "fetch", async (path: string, init: RequestInit) => {
    sent.push([init.method, path, JSON.parse(String(init.body))]);
    return new Response(null, { status: 204 });
  });
  assert.equal(await markXpSeen("belt", 2), undefined);
  assert.equal(await markCelebrated("planner", 1), undefined);
  assert.deepEqual(sent, [
    ["POST", "/api/xp/seen", { key: "belt", level: 2 }],
    ["POST", "/api/xp/planner/celebrated", { tier: 1 }],
  ]);
});
