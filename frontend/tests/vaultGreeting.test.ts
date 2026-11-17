// Tests for the Vault greeting: the robot waits on its hallway seat, cracks the
// door's wheel, the door swings open, and it glides in and hops into its chair.
// Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import { vaultDoor } from "../src/belt/vaultDoor.ts";
import { greetingAt, greetingClock, greetingPoints } from "../src/interior/vaultGreeting.ts";
import { VAULT_GREETING as G } from "../src/interior/stationLayout.ts";

const pts = greetingPoints();
const near = (a: { distanceTo(b: unknown): number }, b: unknown, eps = 1e-6) =>
  a.distanceTo(b) < eps;
const frames = (from: number, to: number) => {
  const out: number[] = [];
  for (let s = from; s <= to + 1e-9; s += 1 / 60) out.push(s);
  return out;
};

test("waits on the hallway seat", () => {
  const f = greetingAt(-1, pts);
  assert.ok(near(f.robot.position, pts.seat));
  assert.equal(f.door, 0);
  assert.equal(f.wheel, 0);
  assert.equal(f.robot.onChair, false);
});

test("cracks the wheel slowly at first", () => {
  const span = G.crack - G.toWheel;
  const end = greetingAt(G.crack, pts).wheel;
  const quarter = greetingAt(G.toWheel + span * 0.25, pts).wheel;
  assert.ok(end > Math.PI, "turns more than half a turn");
  assert.ok(quarter < end * 0.15, `quarter ${quarter} vs end ${end}`);
  let prev = -Infinity;
  for (const s of frames(G.toWheel, G.crack)) {
    const w = greetingAt(s, pts).wheel;
    assert.ok(w >= prev - 1e-9, "never turns back");
    prev = w;
  }
  assert.notEqual(greetingAt(G.toWheel + span / 2, pts).robot.hands, null, "hands on the wheel");
});

test("bolts are back before the door moves", () => {
  for (const s of frames(0, G.seated)) {
    const f = greetingAt(s, pts);
    if (f.door > 0.01) {
      assert.equal(f.bolts, 1);
      return;
    }
  }
  assert.fail("door never opened");
});

test("robot stays in the hallway until the door is mostly open", () => {
  for (const s of frames(-0.5, G.seated + 0.5)) {
    const f = greetingAt(s, pts);
    if (f.robot.position.x > pts.doorway.x) assert.ok(f.door >= 0.9, `at ${s}`);
  }
});

test("hops into the chair", () => {
  let top = -Infinity;
  for (const s of frames(G.glide, G.seated))
    top = Math.max(top, greetingAt(s, pts).robot.position.y);
  assert.ok(top >= pts.chair.y + 0.2, `peak ${top}`);
  for (const s of [G.seated, 99]) {
    const f = greetingAt(s, pts);
    assert.ok(near(f.robot.position, pts.chair));
    assert.equal(f.robot.onChair, true);
    assert.equal(f.door, 1);
    assert.equal(f.robot.hands, null);
  }
});

test("no jumps", () => {
  let prev = greetingAt(-0.5, pts);
  for (const s of frames(-0.5 + 1 / 60, G.seated + 0.5)) {
    const f = greetingAt(s, pts);
    assert.ok(f.robot.position.distanceTo(prev.robot.position) < 0.1, `robot jump at ${s}`);
    assert.ok(Math.abs(f.wheel - prev.wheel) < 0.3, `wheel jump at ${s}`);
    assert.ok(Math.abs(f.robot.yaw - prev.robot.yaw) < 0.2, `turn jump at ${s}`);
    prev = f;
  }
});

test("finishNow reads as finished", () => {
  vaultDoor.resetForTests();
  vaultDoor.claimFirstOpening();
  vaultDoor.finishNow(1000);
  const f = greetingAt((1000 - vaultDoor.openingStart()!) / 1000, pts);
  assert.equal(f.robot.onChair, true);
  assert.equal(f.door, 1);
});

test("reduced motion opening is already over", () => {
  const start = vaultDoor.openingTimeFor(5000, true);
  const f = greetingAt((5000 - start) / 1000, pts);
  assert.equal(f.robot.onChair, true);
  assert.equal(f.door, 1);
});

test("greeting clock: waiting before the first visit, running after, finished if unscheduled", () => {
  vaultDoor.resetForTests();
  assert.ok(greetingClock(1000) < 0, "not opened yet: waiting");
  vaultDoor.claimFirstOpening();
  assert.equal(greetingClock(1000), Infinity, "open with no schedule: finished");
  vaultDoor.scheduleOpening(3000);
  assert.ok(greetingClock(2000) < 0, "scheduled later: still waiting");
  assert.equal(greetingClock(4500), 1.5);
});
