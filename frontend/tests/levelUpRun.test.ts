// Tests for running a level-up moment: it plays once, is held while it plays,
// can be skipped or left, and never celebrates the other mode's data. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { BuildingXp, Mode } from "../src/api.ts";
import { celebrate, LevelUpRunner, newThings, type Moment } from "../src/belt/levelUpRun.ts";
import { PIECE_IDS } from "../src/belt/growth/ladders.ts";
import { PIECE_NAMES } from "../src/belt/levelUpNames.ts";
import { LOOK } from "../src/belt/look.ts";

const plan = { id: "jobs" as const, fromTier: 0, toTier: 2 };
const record: BuildingXp = {
  id: "jobs",
  earning: true,
  xp: 900,
  level: 20,
  level_start_xp: 880,
  next_level_xp: 1000,
  tier: 2,
  seen_level: 20,
  celebrated_tier: 0,
  upgrade_waiting: true,
};
const { settleSeconds, dockSeconds, cheerSeconds } = LOOK.growth.moment;
const WHOLE = dockSeconds + cheerSeconds + LOOK.growth.buildInSeconds;

/** A runner and the moments it reported finished. */
function setup() {
  const runner = new LevelUpRunner();
  const done: { moment: Moment; reason: string }[] = [];
  const start = (p = plan, mode: Mode = "sample", reducedMotion = false) =>
    runner.start(p, mode, {
      reducedMotion,
      onDone: (moment, reason) => done.push({ moment, reason }),
    });
  const run = (seconds: number) => {
    for (let t = 0; t < seconds - 1e-9; t += 0.05) runner.advance(0.05);
  };
  return { runner, done, start, run };
}

test("it waits until ready has held for a moment, and starts again from nothing", () => {
  const { runner } = setup();
  /** Seconds of steady frames until it says yes, at most 5. */
  const steps = (seconds: number) => {
    let ready = false;
    for (let t = 0; t < seconds - 1e-9; t += 0.05) ready = runner.settle(true, 0.05);
    return ready;
  };
  assert.equal(steps(settleSeconds - 0.1), false);
  assert.equal(runner.settle(false, 0.05), false);
  assert.equal(steps(settleSeconds - 0.1), false);
  assert.equal(steps(0.15), true);
});

test("a hitch doesn't skip the settle or a phase", () => {
  const { runner, start } = setup();
  assert.equal(runner.settle(true, 30), false);
  start();
  runner.advance(30);
  assert.equal(runner.running()?.phase, "dock");
});

// Asked every frame, so it hands back what it was given and builds nothing new.
test("what's due is the building's own record, until it has played", () => {
  const { runner, start } = setup();
  const waiting = [
    { ...record, id: "planner" as const },
    { ...record, id: "jobs" as const },
  ];
  const inside = { level: "building", id: "jobs" } as const;
  for (let i = 0; i < 3; i++) {
    assert.equal(runner.due(waiting, inside, "sample", true), waiting[1]);
  }
  assert.equal(runner.due(waiting, inside, "sample", false), null);
  assert.equal(runner.due(waiting, { level: "belt" }, "sample", true), null);
  assert.equal(runner.due(waiting, { level: "screen", id: "jobs" }, "sample", true), null);
  assert.equal(runner.due([], inside, "sample", true), null);
  start();
  runner.finish("skip");
  assert.equal(runner.due(waiting, inside, "sample", true), null);
  assert.equal(runner.due(waiting, inside, "personal", true), waiting[1]);
  const higher = [{ ...record, tier: 3 }];
  assert.equal(runner.due(higher, inside, "sample", true), higher[0]);
});

test("the plan is held: re-renders and refetches never restart it", () => {
  const { runner, start, run } = setup();
  assert.equal(start(), true);
  run(dockSeconds + 0.1);
  const held = runner.running();
  assert.equal(held?.phase, "cheer");
  // The same plan (or a newer one) arriving again changes nothing.
  assert.equal(start(), false);
  assert.equal(start({ ...plan, toTier: 3 }), false);
  assert.equal(runner.running(), held);
  assert.equal(held?.toTier, 2);
});

test("it plays once: the same plan still waiting after done doesn't replay", () => {
  const { runner, done, start, run } = setup();
  start();
  run(WHOLE + 0.2);
  assert.equal(runner.running(), null);
  assert.deepEqual(
    done.map((d) => d.reason),
    ["end"],
  );
  assert.equal(start(), false); // ["xp"] not refetched yet, or the POST failed
  assert.equal(done.length, 1);
});

test("a later, higher upgrade plays from the one just celebrated", () => {
  const { runner, start, run } = setup();
  start();
  run(WHOLE + 0.2);
  assert.equal(start({ id: "jobs", fromTier: 0, toTier: 3 }), true);
  assert.equal(runner.running()?.fromTier, 2);
});

test("the scene keeps the old tier until the build, then shows the new one without flicker", () => {
  const { runner, start, run } = setup();
  start();
  assert.equal(runner.shownTier("sample", "jobs", 0), 0);
  // Even if the server already says 2 (another window), it waits for the build.
  assert.equal(runner.shownTier("sample", "jobs", 2), 0);
  run(dockSeconds + cheerSeconds + 0.1);
  assert.equal(runner.running()?.phase, "build");
  assert.equal(runner.shownTier("sample", "jobs", 0), 2);
  run(WHOLE);
  assert.equal(runner.shownTier("sample", "jobs", 0), 2); // before the refetch
  assert.equal(runner.shownTier("sample", "jobs", 2), 2);
  assert.equal(runner.shownTier("sample", "career", 0), 0);
  assert.equal(runner.shownTier("personal", "jobs", 0), 0);
  assert.equal(runner.shownTier(undefined, "jobs", 0), 0);
});

test("skipping and leaving both end it at done, once", () => {
  for (const reason of ["skip", "leave"] as const) {
    const { runner, done, start } = setup();
    start();
    runner.finish(reason);
    runner.finish(reason);
    assert.deepEqual(
      done.map((d) => d.reason),
      [reason],
    );
    assert.equal(runner.shownTier("sample", "jobs", 0), 2);
    assert.equal(start(), false);
  }
});

test("reduced motion goes straight to the end state", () => {
  const { runner, done, start } = setup();
  assert.equal(start(plan, "sample", true), true);
  assert.equal(runner.running(), null);
  assert.deepEqual(
    done.map((d) => d.reason),
    ["skip"],
  );
  assert.equal(runner.shownTier("sample", "jobs", 0), 2);
});

test("abandoning (a mode switch) reports nothing and can play again", () => {
  const { runner, done, start, run } = setup();
  start();
  run(dockSeconds);
  runner.abandon();
  assert.equal(done.length, 0);
  assert.equal(runner.running(), null);
  assert.equal(runner.last(), null);
  assert.equal(runner.shownTier("sample", "jobs", 0), 0);
  assert.equal(start(), true);
});

test("a click during the moment skips it and is swallowed; the next one isn't", () => {
  const { runner, done, start } = setup();
  start();
  runner.pointerDown();
  assert.equal(done.length, 1);
  assert.equal(runner.swallowsClick(), true);
  runner.pointerDown();
  assert.equal(runner.swallowsClick(), false);
});

test("changing view lets clicks through again, so a keyboard open isn't ignored", () => {
  const { runner, start } = setup();
  start();
  runner.pointerDown();
  runner.releaseClick();
  assert.equal(runner.swallowsClick(), false);
});

test("listeners hear starts, phases and ends, and the snapshot is stable between them", () => {
  const { runner, start, run } = setup();
  let heard = 0;
  const stop = runner.subscribe(() => heard++);
  start();
  const first = runner.snapshot();
  runner.advance(0.05);
  assert.equal(runner.snapshot(), first);
  run(WHOLE + 0.2);
  assert.equal(heard, 4); // start, cheer, build, end
  stop();
});

const deps = (over: Partial<Parameters<typeof celebrate>[1]> = {}) => {
  const log: string[] = [];
  return {
    log,
    all: {
      cachedMode: () => "sample" as Mode | undefined,
      switching: () => false,
      fetchMode: async () => "sample" as Mode,
      post: async (id: string, tier: number) => void log.push(`post ${id} ${tier}`),
      refresh: async () => void log.push("refresh"),
      ...over,
    },
  };
};
const moment: Moment = { ...plan, mode: "sample", phase: "done" };

test("done saves the upgrade, then refetches XP", async () => {
  const d = deps();
  await celebrate(moment, d.all);
  assert.deepEqual(d.log, ["post jobs 2", "refresh"]);
});

test("nothing is saved if the mode changed or is changing", async () => {
  for (const over of [
    { cachedMode: () => "personal" as const },
    { cachedMode: () => undefined },
    { switching: () => true },
    { fetchMode: async () => "personal" as const },
  ]) {
    const d = deps(over);
    await celebrate(moment, d.all);
    assert.ok(!d.log.some((l) => l.startsWith("post")), JSON.stringify(Object.keys(over)));
  }
});

test("a switch that starts while the mode is being checked stops the save", async () => {
  let switching = false;
  const d = deps({
    switching: () => switching,
    fetchMode: async () => {
      switching = true;
      return "sample" as const;
    },
  });
  await celebrate(moment, d.all);
  assert.deepEqual(d.log, []);
});

test("a failed save doesn't throw", async () => {
  const d = deps({
    post: async () => {
      throw new Error("503");
    },
  });
  await celebrate(moment, d.all);
  assert.deepEqual(d.log, ["refresh"]);
});

test("every upgrade piece has a short name", () => {
  for (const id of PIECE_IDS) {
    assert.ok(PIECE_NAMES[id], id);
    assert.ok(PIECE_NAMES[id].length <= 28, PIECE_NAMES[id]);
  }
});

test("several waiting tiers list everything new, oldest first", () => {
  const things = newThings("jobs", 1, 3);
  assert.deepEqual(
    things.map((t) => t.key),
    ["deckRing2", "signalRings", "landmark"],
  );
  assert.equal(things.at(-1)!.label, "Bigger radar dish");
  assert.deepEqual(newThings("jobs", 2, 2), []);
  assert.deepEqual(
    newThings("planner", 4, 5).map((t) => t.key),
    ["wallScreens"],
  );
});
