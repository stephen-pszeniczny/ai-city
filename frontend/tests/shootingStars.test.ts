// Tests for shooting-star timing. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import { mulberry32 } from "../src/interior/robotBrain.ts";
import { nextGap, shootingStarsEnabled } from "../src/belt/space/starTiming.ts";

test("gaps stay within min and max", () => {
  const rng = mulberry32(3);
  for (let i = 0; i < 2000; i++) {
    const g = nextGap(rng, 20, 60);
    assert.ok(g >= 20 && g <= 60, String(g));
  }
});

test("no shooting stars with reduced motion", () => {
  assert.equal(shootingStarsEnabled(true), false);
  assert.equal(shootingStarsEnabled(false), true);
});
