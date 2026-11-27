// Tests that Opportunity Office's radar dish stays well away from the desk in the
// building view, at every stage and through whole turns. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import { sweepLandmark, type Rect } from "./dishScreen.ts";
import { make } from "./growthStub.ts";

/** The smallest gap allowed to the robot, desk or monitor, as a share of view height. */
const CLEAR = 0.05;
/** Window shapes the building view must work at. */
const SHAPES = [
  [1440, 900],
  [1920, 1080],
  [1100, 700],
  [1000, 900],
  [2000, 900],
] as const;
const TIERS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const swept = new Map<number, ReturnType<typeof sweepLandmark>>();
function sweep(tier: number) {
  let s = swept.get(tier);
  if (!s) {
    const a = make("jobs");
    a.growth.setTier(tier);
    swept.set(tier, (s = sweepLandmark(a)));
  }
  return s;
}

// One measurement per tier covers all of SHAPES: the lens is a fixed vertical angle, so
// gaps in view heights are the same at every shape (see dishScreen.ts). Dishes are
// posed every 4 degrees; between poses a rim moves about 1% of view height at most,
// and the gaps are about 10%.
for (const tier of TIERS) {
  test(`jobs tier ${tier}: at every window shape, the turning dish keeps clear of the desk`, () => {
    const { gap, nearest } = sweep(tier);
    assert.ok(gap >= CLEAR, `${(gap * 100).toFixed(1)}% of view height from the ${nearest}`);
  });
}

const insideView = (r: Rect, width: number, height: number) => {
  const side = width / height / 2;
  return r.left >= -side && r.right <= side && r.top <= 0.5 && r.bottom >= -0.5;
};
const say = (r: Rect) =>
  `x ${r.left.toFixed(2)} to ${r.right.toFixed(2)}, y ${r.bottom.toFixed(2)} to ${r.top.toFixed(2)}`;

test("jobs: today's dish is a background landmark, under a third of the view tall", () => {
  // Dish, mast and platform; the boom under them is support.
  const { standing } = sweep(0);
  const tall = standing.top - standing.bottom;
  assert.ok(tall < 1 / 3, `${(tall * 100).toFixed(0)}% tall`);
});

for (const [width, height] of SHAPES) {
  test(`jobs at ${width}x${height}: today's turning dish is wholly in the picture`, () => {
    for (const tier of [0, 1, 2]) {
      const [dish] = sweep(tier).dishes;
      assert.ok(insideView(dish!, width, height), `tier ${tier}: ${say(dish!)}`);
    }
  });
}
