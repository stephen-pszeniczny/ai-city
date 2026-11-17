// Tests for the camera's flight paths and the skip/Escape rules. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import { LOOK } from "../src/belt/look.ts";
import {
  asteroidArc,
  reversePath,
  samplePath,
  stationPath,
  type Pose,
} from "../src/belt/flightPath.ts";
import { escapeAction, flightState } from "../src/belt/flightState.ts";
import { MODULE_X, ROOM_OFFSET, roomView, VAULT_DOOR } from "../src/interior/stationLayout.ts";

const BELT: Pose = { position: new THREE.Vector3(0, 22, 78), target: new THREE.Vector3(0, 0, 0) };
const near = (a: THREE.Vector3, b: THREE.Vector3) => a.distanceTo(b) < 1e-6;

test("path starts from the given pose", () => {
  const from: Pose = { position: new THREE.Vector3(5, 6, 7), target: new THREE.Vector3(1, 2, 3) };
  const p = samplePath(stationPath("planner", from, { stopAtDoor: false }), 0);
  assert.ok(near(p.position, from.position));
  assert.ok(near(p.target, from.target));
});

test("path ends exactly on the last waypoint", () => {
  const path = stationPath("planner", BELT, { stopAtDoor: false });
  const last = path[path.length - 1]!;
  const p = samplePath(path, last.at + 5);
  assert.ok(near(p.position, last.position));
  const room = new THREE.Vector3(MODULE_X.planner, 0, 0).add(ROOM_OFFSET);
  assert.ok(near(last.position, room.clone().add(roomView("planner").camera)));
});

test("reverse path ends where forward began", () => {
  const path = stationPath("finance", BELT, { stopAtDoor: false });
  const back = reversePath(path);
  const end = samplePath(back, back[back.length - 1]!.at);
  assert.ok(near(end.position, BELT.position));
  assert.equal(back[0]!.at, 0);
});

test("station path to the vault stops at the door when asked", () => {
  const path = stationPath("finance", BELT, { stopAtDoor: true });
  const stops = path.filter((w, i) => i > 0 && near(w.position, path[i - 1]!.position));
  assert.equal(stops.length, 1, "one hold");
  const hold = stops[0]!;
  assert.ok(hold.position.x < VAULT_DOOR.x, "holds in front of the door");
  assert.ok(hold.target.x >= VAULT_DOOR.x - 0.01, "looking at the door");
});

test("station path to Mission Control turns left (negative x)", () => {
  const path = stationPath("planner", BELT, { stopAtDoor: false });
  assert.ok(path.slice(3).every((w) => w.position.x <= 0.001));
});

test("durations match LOOK", () => {
  const path = stationPath("planner", BELT, { stopAtDoor: false });
  assert.ok(Math.abs(path[path.length - 1]!.at - LOOK.flights.toStationSeconds) < 1e-9);
  const vault = stationPath("finance", BELT, { stopAtDoor: true });
  assert.ok(vault[vault.length - 1]!.at > LOOK.flights.toStationSeconds + 3);
});

test("samplePath moves forward smoothly (no jumps)", () => {
  const path = stationPath("finance", BELT, { stopAtDoor: false });
  let prev = samplePath(path, 0).position;
  for (let s = 0.02; s <= path[path.length - 1]!.at; s += 0.02) {
    const p = samplePath(path, s).position;
    assert.ok(p.distanceTo(prev) < 2.5, `jump at ${s}`);
    prev = p;
  }
});

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
