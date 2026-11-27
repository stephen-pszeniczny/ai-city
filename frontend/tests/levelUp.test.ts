// Tests for the level-up moment: when it plays and which phase it's in. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { BuildingXp } from "../src/api.ts";
import { phaseAt, planLevelUp } from "../src/belt/levelUp.ts";
import type { View } from "../src/belt/levels.ts";
import { LOOK } from "../src/belt/look.ts";

const building = (over: Partial<BuildingXp> = {}): BuildingXp => ({
  id: "jobs",
  earning: true,
  xp: 900,
  level: 10,
  level_start_xp: 880,
  next_level_xp: 1000,
  tier: 1,
  seen_level: 10,
  celebrated_tier: 0,
  upgrade_waiting: true,
  ...over,
});

const inside: View = { level: "building", id: "jobs" };

test("a waiting upgrade plays inside its building", () => {
  assert.deepEqual(planLevelUp(building(), inside, true), { id: "jobs", fromTier: 0, toTier: 1 });
});

test("no plan on the belt, at the screen level or inside another building", () => {
  assert.equal(planLevelUp(building(), { level: "belt" }, true), null);
  assert.equal(planLevelUp(building(), { level: "screen", id: "jobs" }, true), null);
  assert.equal(planLevelUp(building(), { level: "building", id: "career" }, true), null);
});

test("no plan during a flight", () => {
  assert.equal(planLevelUp(building(), inside, false), null);
});

test("the Vault's upgrade waits until it's ready", () => {
  const vault = building({ id: "finance" });
  const view: View = { level: "building", id: "finance" };
  assert.equal(planLevelUp(vault, view, false), null);
  assert.deepEqual(planLevelUp(vault, view, true), { id: "finance", fromTier: 0, toTier: 1 });
});

test("no plan with nothing waiting", () => {
  const celebrated = building({ celebrated_tier: 1, upgrade_waiting: false });
  assert.equal(planLevelUp(celebrated, inside, true), null);
});

test("no plan for a building that isn't earning", () => {
  assert.equal(planLevelUp(building({ earning: false }), inside, true), null);
});

test("multiple pending tiers play once to newest", () => {
  const pending = building({ tier: 3, celebrated_tier: 0 });
  assert.deepEqual(planLevelUp(pending, inside, true), { id: "jobs", fromTier: 0, toTier: 3 });
  // What the backend sends back after markCelebrated("jobs", 3).
  const after = building({ tier: 3, celebrated_tier: 3, upgrade_waiting: false });
  assert.equal(planLevelUp(after, inside, true), null);
});

test("the moment goes dock, cheer, build, done", () => {
  assert.equal(phaseAt(0), "dock");
  assert.equal(phaseAt(3), "cheer");
  assert.equal(phaseAt(5), "build");
  assert.equal(phaseAt(99), "done");
});

test("each phase starts where the one before ends", () => {
  const dock = LOOK.growth.moment.dockSeconds;
  const cheer = dock + LOOK.growth.moment.cheerSeconds;
  const end = cheer + LOOK.growth.buildInSeconds;
  assert.equal(phaseAt(dock - 0.01), "dock");
  assert.equal(phaseAt(dock), "cheer");
  assert.equal(phaseAt(cheer - 0.01), "cheer");
  assert.equal(phaseAt(cheer), "build");
  assert.equal(phaseAt(end - 0.01), "build");
  assert.equal(phaseAt(end), "done");
});
