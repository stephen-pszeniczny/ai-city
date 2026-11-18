// Tests for the notification rules: the shuttle queue, banner and ticker wording,
// the flight path, the way to a task from anywhere, and the open-task request.
// Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import type { BuildingId, NotificationItem } from "../src/api.ts";
import type { View } from "../src/belt/levels.ts";
import { stepsToTask } from "../src/notifications/journey.ts";
import {
  bannerText,
  nextTickerIndex,
  planShuttles,
  queueAfterModeChange,
  shortTitle,
  tickerPosition,
} from "../src/notifications/rules.ts";
import { pointOnPath, shuttlePath } from "../src/notifications/shuttlePath.ts";
import { requestOpenTask, takeOpenTaskRequest } from "../src/todo/openRequest.ts";

const item = (id: number, title = `Reminder ${id}`): NotificationItem => ({
  id,
  kind: "reminder",
  task_id: id * 10,
  title,
  due_at: `2026-11-18T12:0${id}`,
  seen: false,
});

test("up to three shuttles fly separately, the rest share a +N more shuttle", () => {
  const trips = planShuttles(
    [1, 2, 3, 4, 5].map((i) => item(i)),
    3,
  );
  assert.equal(trips.length, 4);
  assert.deepEqual(
    trips.map((t) => t.ids),
    [[1], [2], [3], [4, 5]],
  );
  assert.equal(trips[0]?.text, "Reminder 1");
  assert.equal(trips[3]?.text, "+2 more reminders");
});

test("three or fewer: one trip each, oldest first", () => {
  const trips = planShuttles([item(1), item(2)], 3);
  assert.deepEqual(
    trips.map((t) => t.ids),
    [[1], [2]],
  );
  assert.deepEqual(planShuttles([], 3), []);
});

test("one more than the limit says '+1 more reminder'", () => {
  const trips = planShuttles(
    [1, 2, 3, 4].map((i) => item(i)),
    3,
  );
  assert.equal(trips[3]?.text, "+1 more reminder");
});

test("long titles are cut at a word with an ellipsis; short ones are untouched", () => {
  assert.equal(shortTitle("  Water the plants  ", 48), "Water the plants");
  const long = "Call the insurance company about the renewal letter that came last week";
  const cut = shortTitle(long, 48);
  assert.ok(cut.length <= 48, cut);
  assert.ok(cut.endsWith("…"));
  assert.ok(!cut.includes(" …"), "no space before the ellipsis");
  assert.ok(long.startsWith(cut.slice(0, -1)));
  // One long word with no spaces is still cut.
  assert.equal(shortTitle("x".repeat(60), 48).length, 48);
});

test("banner text says REMINDER · title; the +N more text stays as it is", () => {
  assert.equal(bannerText({ ids: [1], text: "Water the plants" }), "REMINDER · Water the plants");
  assert.equal(bannerText({ ids: [4, 5], text: "+2 more reminders" }), "+2 more reminders");
});

test("ticker shows 1 of 3, nothing for a single item, and wraps", () => {
  assert.equal(tickerPosition(0, 3), "1 of 3");
  assert.equal(tickerPosition(0, 1), "");
  assert.equal(nextTickerIndex(2, 3), 0);
  assert.equal(nextTickerIndex(0, 3), 1);
  assert.equal(nextTickerIndex(5, 0), 0);
});

test("a mode change empties the shuttle queue; the same mode keeps it", () => {
  const queue = [{ ids: [1], text: "Secret personal thing" }];
  assert.deepEqual(queueAfterModeChange("personal", "sample", queue), []);
  assert.deepEqual(queueAfterModeChange("sample", "sample", queue), queue);
  assert.deepEqual(queueAfterModeChange(undefined, "sample", queue), queue);
});

test("the shuttle path starts and ends off screen on opposite sides, from any camera angle", () => {
  const target = new THREE.Vector3(0, 0, 0);
  const home = new THREE.Vector3(0, 22, 78);
  for (const turn of [0, 0.5, 1.4, 2.6, 4.0]) {
    for (const zoom of [0.4, 1, 3]) {
      const pos = home
        .clone()
        .multiplyScalar(zoom)
        .applyAxisAngle(new THREE.Vector3(0, 1, 0), turn);
      const cam = new THREE.PerspectiveCamera(38, 1.6, 0.5, 20000);
      cam.position.copy(pos);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      const p = shuttlePath(pos, target, 38);
      const from = p.from.clone().project(cam);
      const to = p.to.clone().project(cam);
      const mid = pointOnPath(p, 0.5).clone().project(cam);
      assert.ok(Math.abs(from.x) > 1 && Math.abs(to.x) > 1, `ends off screen (turn ${turn})`);
      assert.ok(Math.sign(from.x) !== Math.sign(to.x), "opposite sides");
      assert.ok(Math.abs(mid.x) < 0.3, "crosses the middle");
      assert.ok(mid.y > 0.55 && mid.y < 0.8, `the band under the top bar (y ${mid.y})`);
      assert.ok(from.z < 1 && to.z < 1 && mid.z < 1, "in front of the camera");
    }
  }
});

test("pointOnPath starts at from and ends at to", () => {
  const p = shuttlePath(new THREE.Vector3(0, 22, 78), new THREE.Vector3(), 38);
  assert.ok(pointOnPath(p, 0).distanceTo(p.from) < 1e-9);
  assert.ok(pointOnPath(p, 1).distanceTo(p.to) < 1e-9);
});

test("steps to a task from the belt, Mission Control, the Vault, an asteroid and a screen", () => {
  const b = (id: BuildingId): View => ({ level: "building", id });
  const planner: View = { level: "building", id: "planner" };
  const screen: View = { level: "screen", id: "planner" };
  assert.deepEqual(stepsToTask({ level: "belt" }), [planner, screen]);
  assert.deepEqual(stepsToTask(planner), [screen]);
  assert.deepEqual(stepsToTask(b("finance")), [planner, screen]);
  assert.deepEqual(stepsToTask(b("jobs")), [{ level: "belt" }, planner, screen]);
  assert.deepEqual(stepsToTask(screen), []);
  assert.deepEqual(stepsToTask({ level: "screen", id: "gym" }), [
    b("gym"),
    { level: "belt" },
    planner,
    screen,
  ]);
});

test("an open-task request is taken once", () => {
  assert.equal(takeOpenTaskRequest(), null);
  requestOpenTask(42);
  assert.equal(takeOpenTaskRequest(), 42);
  assert.equal(takeOpenTaskRequest(), null);
});
