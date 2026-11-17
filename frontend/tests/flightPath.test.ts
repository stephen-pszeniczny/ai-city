// Tests for the asteroid flight curve and the skip/Escape rules. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import { asteroidArc, type Pose } from "../src/belt/flightPath.ts";
import { escapeAction, flightState } from "../src/belt/flightState.ts";

const BELT: Pose = { position: new THREE.Vector3(0, 22, 78), target: new THREE.Vector3(0, 0, 0) };
const near = (a: THREE.Vector3, b: THREE.Vector3) => a.distanceTo(b) < 1e-6;

test("asteroidArc k=0 is from and k=1 is goal", () => {
  const goal: Pose = {
    position: new THREE.Vector3(30, 3, 10),
    target: new THREE.Vector3(31, 2, 12),
  };
  assert.ok(near(asteroidArc(BELT, goal, 0).position, BELT.position));
  const end = asteroidArc(BELT, goal, 1);
  assert.ok(near(end.position, goal.position));
  assert.ok(near(end.target, goal.target));
});

test("asteroidArc swings off the straight line midway", () => {
  const goal: Pose = {
    position: new THREE.Vector3(30, 3, 10),
    target: new THREE.Vector3(31, 2, 12),
  };
  const mid = asteroidArc(BELT, goal, 0.5).position;
  const straight = BELT.position.clone().lerp(goal.position, 0.5);
  assert.ok(mid.distanceTo(straight) > 1);
});

test("escape during flight skips, does not navigate", () => {
  assert.equal(escapeAction({ flying: true, inTextField: false, atBelt: false }), "skip");
  assert.equal(escapeAction({ flying: false, inTextField: false, atBelt: false }), "back");
  assert.equal(escapeAction({ flying: false, inTextField: true, atBelt: false }), "none");
  assert.equal(escapeAction({ flying: false, inTextField: false, atBelt: true }), "none");
});

test("skip is remembered until the flight ends", () => {
  flightState.start();
  assert.equal(flightState.flying(), true);
  flightState.skip();
  assert.equal(flightState.skipRequested(), true);
  flightState.end();
  assert.equal(flightState.flying(), false);
  assert.equal(flightState.skipRequested(), false);
});
