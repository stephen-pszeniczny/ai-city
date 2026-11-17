// Tests for the robot's action picker: random order, never the same action
// twice in a row, typing most common. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import { motionScale } from "../src/belt/look.ts";
import { DURATIONS, mulberry32, RobotBrain, type RobotAction } from "../src/interior/robotBrain.ts";

/** Run a brain for `n` actions and return them in order. */
function sequence(brain: RobotBrain, n: number): RobotAction[] {
  const out: RobotAction[] = [brain.update(0).action];
  let t = 0;
  while (out.length < n) {
    t += 0.25;
    const before = brain.changes;
    const a = brain.update(t).action;
    if (brain.changes !== before) out.push(a);
  }
  return out;
}

test("never repeats an action twice in a row", () => {
  const brain = new RobotBrain(1);
  let t = 0;
  let prev = brain.update(0).action;
  let changes = 0;
  while (changes < 10_000) {
    t += 0.25;
    const before = brain.changes;
    const a = brain.update(t).action;
    if (brain.changes !== before) {
      assert.notEqual(a, prev, `repeated ${a} at change ${changes}`);
      prev = a;
      changes++;
    }
  }
});

test("typing is the most common action", () => {
  const counts = new Map<RobotAction, number>();
  for (const a of sequence(new RobotBrain(7), 10_000)) counts.set(a, (counts.get(a) ?? 0) + 1);
  const typing = counts.get("type") ?? 0;
  for (const [a, n] of counts)
    if (a !== "type") assert.ok(typing > n, `${a} ${n} >= type ${typing}`);
});

test("fun share follows funShare", () => {
  const seq = sequence(new RobotBrain(3, { funShare: 0.05 }), 10_000);
  const fun = seq.filter((a) => a === "spin" || a === "wave" || a === "stretch").length;
  assert.ok(fun / seq.length < 0.1, `fun share ${fun / seq.length}`);
});

test("react() makes the next action wave or spin", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const brain = new RobotBrain(seed);
    brain.update(0);
    brain.react();
    const a = brain.update(0.01).action;
    assert.ok(a === "wave" || a === "spin", `seed ${seed}: ${a}`);
  }
});

test("a long gap gives one transition", () => {
  const brain = new RobotBrain(5);
  brain.update(0);
  const before = brain.changes;
  brain.update(600);
  assert.equal(brain.changes - before, 1);
});

test("same seed, same sequence; different seeds differ", () => {
  assert.deepEqual(sequence(new RobotBrain(11), 50), sequence(new RobotBrain(11), 50));
  assert.notDeepEqual(sequence(new RobotBrain(11), 50), sequence(new RobotBrain(12), 50));
});

test("durations stay in range", () => {
  const brain = new RobotBrain(9);
  let t = 0;
  let current = brain.update(0);
  let started = 0;
  let checked = 0;
  while (checked < 500) {
    t += 0.05;
    const s = brain.update(t);
    if (s.action !== current.action) {
      const [min, max] = DURATIONS[current.action];
      const took = t - started;
      assert.ok(took >= min - 0.06 && took <= max + 0.06, `${current.action} took ${took}`);
      started = t;
      current = s;
      checked++;
    }
  }
});

test("progress runs from 0 to 1 within an action", () => {
  const brain = new RobotBrain(2);
  const a = brain.update(0);
  assert.equal(a.progress, 0);
  const mid = brain.update(0.5);
  assert.ok(mid.progress > 0 && mid.progress <= 1);
});

test("tick advances while typing or switching tabs", () => {
  const brain = new RobotBrain(4);
  const start = brain.update(0).tick;
  let t = 0;
  let end = start;
  while (t < 120) {
    t += 0.1;
    end = brain.update(t).tick;
  }
  assert.ok(end > start + 10, `tick only reached ${end}`);
});

test("motionScale: calmer with reduced motion", () => {
  assert.equal(motionScale(true), 0.3);
  assert.equal(motionScale(false), 1);
});

test("mulberry32 gives numbers in [0, 1)", () => {
  const r = mulberry32(42);
  for (let i = 0; i < 1000; i++) {
    const x = r();
    assert.ok(x >= 0 && x < 1);
  }
});

test("force() makes that action next, even a repeat-safe one", () => {
  const brain = new RobotBrain(8);
  brain.update(0);
  brain.force("wave");
  assert.equal(brain.update(0.01).action, "wave");
});
