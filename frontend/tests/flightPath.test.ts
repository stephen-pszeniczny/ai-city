// Tests for the asteroid flight curve and the skip/Escape rules. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import { APPROACH, asteroidApproach, asteroidArc, type Pose } from "../src/belt/flightPath.ts";
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

const DESK: Pose = {
  position: new THREE.Vector3(33, 4.3, 8),
  target: new THREE.Vector3(32, 3, 11),
};

test("the approach starts at the belt view and ends exactly at the desk view", () => {
  const start = asteroidApproach(BELT, DESK, 0);
  assert.ok(near(start.position, BELT.position) && near(start.target, BELT.target));
  const end = asteroidApproach(BELT, DESK, 1);
  assert.ok(near(end.position, DESK.position) && near(end.target, DESK.target));
});

test("the approach finishes straight along the desk camera's own view", () => {
  const behind = DESK.position.clone().sub(DESK.target).normalize();
  const line = new THREE.Line3(DESK.position, DESK.position.clone().addScaledVector(behind, 50));
  let last = Infinity;
  for (let k = APPROACH.swingUntil; k <= 1; k += 0.01) {
    const { position, target } = asteroidApproach(BELT, DESK, k);
    const on = line.closestPointToPoint(position, true, new THREE.Vector3());
    assert.ok(on.distanceTo(position) < 1e-6, `k=${k}`);
    assert.ok(near(target, DESK.target), `k=${k}`);
    const left = position.distanceTo(DESK.position);
    assert.ok(left <= last, "always closing in");
    last = left;
  }
});

test("the approach is one smooth move: no stall and no jump in speed", () => {
  const STEPS = 400;
  const at = (i: number) => asteroidApproach(BELT, DESK, i / STEPS).position;
  const velocity = Array.from({ length: STEPS }, (_, i) => at(i + 1).sub(at(i)));
  const top = Math.max(...velocity.map((v) => v.length()));
  velocity.slice(1).forEach((v, i) => {
    assert.ok(v.distanceTo(velocity[i]!) < top * 0.04, `jolt at step ${i}`);
  });
  for (let i = STEPS * 0.05; i < STEPS * 0.95; i++) {
    assert.ok(velocity[i]!.length() > top * 0.04, `stalls at step ${i}`);
  }
});

/** Bearing and distance out from the desk's screen. */
const roundDesk = (p: THREE.Vector3) =>
  new THREE.Cylindrical().setFromVector3(p.clone().sub(DESK.target));

test("the approach turns one way only, never swaying back and forth", () => {
  const turn = {};
  const bearings = Array.from(
    { length: 201 },
    (_, i) => roundDesk(asteroidApproach(BELT, DESK, i / 200, turn).position).theta,
  );
  const steps = bearings.slice(1).map((b, i) => {
    const d = b - bearings[i]!;
    return d - Math.PI * 2 * Math.round(d / (Math.PI * 2));
  });
  assert.ok(steps.every((d) => d > -1e-6) || steps.every((d) => d < 1e-6));
});

test("the approach stays well clear of the asteroid until it's lined up behind the desk", () => {
  // From straight across the asteroid, the worst case: it goes round, not through.
  const behind = DESK.position.clone().sub(DESK.target).setY(0).normalize();
  const across: Pose = {
    position: DESK.target
      .clone()
      .addScaledVector(behind, -45)
      .setY(DESK.target.y + 4),
    target: new THREE.Vector3(),
  };
  const turn = {};
  for (let k = 0; k <= APPROACH.runFrom; k += 0.01) {
    const at = asteroidApproach(across, DESK, k, turn).position;
    assert.ok(roundDesk(at).radius > 15, `k=${k}: ${roundDesk(at).radius}`);
  }
});

test("a moving desk never flips which way round the approach goes", () => {
  // The start is almost exactly opposite, and the desk turns past that point in flight.
  const behind = DESK.position.clone().sub(DESK.target);
  const opposite: Pose = {
    position: DESK.target.clone().addScaledVector(behind.clone().setY(0).normalize(), -45),
    target: new THREE.Vector3(),
  };
  const turn = {};
  let last: THREE.Vector3 | null = null;
  for (let i = 0; i <= 180; i++) {
    const spun = behind.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.05 + (0.1 * i) / 180);
    const goal = { position: DESK.target.clone().add(spun), target: DESK.target };
    const at = asteroidApproach(opposite, goal, i / 180, turn).position;
    if (last) assert.ok(at.distanceTo(last) < 4, `jumped ${at.distanceTo(last)} at frame ${i}`);
    last = at;
  }
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
