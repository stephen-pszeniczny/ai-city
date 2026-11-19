// Tests for the shared desk lights: one fixed set of lights that moves to the
// closest close-up desk, so the scene's light count never changes. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import * as THREE from "three";

import { DESK_LIGHT_COUNT, DeskLightRegistry } from "../src/belt/deskLights.ts";

function marks(x: number) {
  const work = new THREE.Object3D();
  work.position.set(x, 0, 0);
  work.updateMatrixWorld();
  return { work, glow: new THREE.Object3D(), lamp: new THREE.Object3D() };
}

test("there is always the same number of desk lights", () => {
  assert.equal(DESK_LIGHT_COUNT, 3);
});

test("no desk close up: nothing to light", () => {
  const r = new DeskLightRegistry();
  r.register("jobs", marks(10));
  assert.equal(r.closestNear(new THREE.Vector3()), null);
});

test("the closest close-up desk gets the lights", () => {
  const r = new DeskLightRegistry();
  const far = marks(10);
  const nearer = marks(4);
  r.register("jobs", far);
  r.register("career", nearer);
  r.setNear("jobs", true);
  r.setNear("career", true);
  assert.equal(r.closestNear(new THREE.Vector3()), nearer);
});

test("a desk that leaves is forgotten", () => {
  const r = new DeskLightRegistry();
  r.register("jobs", marks(1));
  r.setNear("jobs", true);
  r.unregister("jobs");
  assert.equal(r.closestNear(new THREE.Vector3()), null);
});
