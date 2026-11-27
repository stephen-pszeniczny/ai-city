// Tests for the design kit's small helpers. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import { clamp01, progressPercent } from "../src/ui/kit.ts";

test("clamp01 keeps values between 0 and 1", () => {
  assert.equal(clamp01(-1), 0);
  assert.equal(clamp01(0.4), 0.4);
  assert.equal(clamp01(2), 1);
  assert.equal(clamp01(Number.NaN), 0);
});

test("progressPercent rounds to a whole percent", () => {
  assert.equal(progressPercent(0.425), "43%");
  assert.equal(progressPercent(-1), "0%");
  assert.equal(progressPercent(2), "100%");
  assert.equal(progressPercent(Number.NaN), "0%");
});
