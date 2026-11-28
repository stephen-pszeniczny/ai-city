// Tests for the upgrade ladders: what each building gains every 10 levels. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  asteroidScaleAt,
  LADDERS,
  landmarkStageAt,
  PIECE_IDS,
  piecesUpTo,
  type GrowthId,
} from "../src/belt/growth/ladders.ts";
import { LOOK } from "../src/belt/look.ts";

const IDS: GrowthId[] = ["planner", "finance", "jobs", "career"];
const ASTEROIDS: GrowthId[] = ["jobs", "career"];
const MODULES: GrowthId[] = ["planner", "finance"];
const TIERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

test("every ladder has tiers 1 to 10, once each and in order", () => {
  assert.deepEqual(Object.keys(LADDERS).sort(), [...IDS].sort());
  for (const id of IDS) {
    assert.deepEqual(
      LADDERS[id].map((step) => step.tier),
      TIERS,
      id,
    );
  }
});

test("every upgrade adds something to see", () => {
  for (const id of IDS) {
    for (const step of LADDERS[id]) {
      assert.ok(step.pieces.length > 0 || step.landmarkStage, `${id} tier ${step.tier}`);
    }
  }
});

test("asteroid landmarks grow at tiers 3, 6 and 10 only", () => {
  for (const id of ASTEROIDS) {
    const grown = LADDERS[id]
      .filter((step) => step.landmarkStage !== undefined)
      .map((step) => [step.tier, step.landmarkStage]);
    assert.deepEqual(
      grown,
      [
        [3, 2],
        [6, 3],
        [10, 4],
      ],
      id,
    );
  }
});

test("station modules have no landmark", () => {
  for (const id of MODULES) {
    assert.ok(
      LADDERS[id].every((step) => step.landmarkStage === undefined),
      id,
    );
    assert.equal(landmarkStageAt(id, 10), 1, id);
  }
});

test("the landmark stage is the newest one reached", () => {
  const stages = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((t) => landmarkStageAt("jobs", t));
  assert.deepEqual(stages, [1, 1, 1, 2, 2, 2, 3, 3, 3, 3, 4]);
  assert.equal(landmarkStageAt("career", 0), 1);
  assert.equal(landmarkStageAt("career", 10), 4);
});

test("only the control-room steps are marked as inside", () => {
  const inside = (id: GrowthId) =>
    LADDERS[id].filter((step) => step.interior).map((step) => step.tier);
  assert.deepEqual(inside("planner"), [5, 9]);
  assert.deepEqual(inside("finance"), [5, 7, 9]);
  assert.deepEqual(inside("jobs"), []);
  assert.deepEqual(inside("career"), []);
});

test("pieces add up tier by tier, in ladder order", () => {
  for (const id of IDS) {
    assert.deepEqual(piecesUpTo(id, 0), [], id);
    for (const tier of TIERS) {
      assert.deepEqual(
        piecesUpTo(id, tier),
        [...piecesUpTo(id, tier - 1), ...LADDERS[id][tier - 1]!.pieces],
        `${id} tier ${tier}`,
      );
    }
  }
  assert.deepEqual(piecesUpTo("planner", 3), ["hullLights", "extraAntenna", "roofDish"]);
});

test("a building never gets the same piece twice", () => {
  for (const id of IDS) {
    const all = piecesUpTo(id, 10);
    assert.equal(new Set(all).size, all.length, id);
  }
});

test("every piece id is on some ladder, and listed once", () => {
  assert.equal(new Set(PIECE_IDS).size, PIECE_IDS.length);
  const used = new Set(IDS.flatMap((id) => piecesUpTo(id, 10)));
  assert.deepEqual([...used].sort(), [...PIECE_IDS].sort());
});

test("asteroids grow gently, from their own size to at most 1.3 times", () => {
  assert.equal(LOOK.growth.maxAsteroidScale, 1.3);
  assert.equal(asteroidScaleAt(0), 1);
  assert.equal(asteroidScaleAt(10), LOOK.growth.maxAsteroidScale);
  assert.ok(asteroidScaleAt(10) <= 1.3);
  for (const tier of TIERS) {
    assert.ok(asteroidScaleAt(tier) >= asteroidScaleAt(tier - 1), `tier ${tier}`);
  }
});

test("a tier outside 0 to 10 is held at the nearest end", () => {
  assert.equal(asteroidScaleAt(-1), 1);
  assert.equal(asteroidScaleAt(11), asteroidScaleAt(10));
});

test("one asteroid can be kept flatter, never bigger than the limit", () => {
  assert.equal(asteroidScaleAt(10, "jobs", { jobs: 1 }), 1);
  assert.equal(asteroidScaleAt(5, "jobs", { jobs: 1.1 }), 1.05);
  assert.equal(asteroidScaleAt(10, "career", { jobs: 1.1 }), 1.3);
  assert.equal(asteroidScaleAt(10, "jobs", { jobs: 2 }), 1.3);
  assert.equal(asteroidScaleAt(10, "jobs", { jobs: 0.5 }), 1);
});
