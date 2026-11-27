// Tests for when 3D pieces animate (the scene holds still behind the computer). Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import { shouldAnimate } from "../src/belt/hold.ts";

test("held behind the computer screen, pieces stop", () => {
  assert.equal(shouldAnimate({ hold: true, inView: true, keepMoving: false }), false);
});

test("the asteroid orbit keeps moving even when held", () => {
  assert.equal(shouldAnimate({ hold: true, inView: true, keepMoving: true }), true);
});

test("out of view, pieces stop", () => {
  assert.equal(shouldAnimate({ hold: false, inView: false, keepMoving: false }), false);
});

test("in view and not held, pieces animate (leaving the screen resumes at once)", () => {
  assert.equal(shouldAnimate({ hold: false, inView: true, keepMoving: false }), true);
});
