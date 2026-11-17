// Tests for the vault door (opens once per app session) and the Mission
// Control hallway status screens (counts and status only). Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import * as THREE from "three";

import { hallwayStatus } from "../src/belt/hallwayStatus.ts";
import { vaultDoor } from "../src/belt/vaultDoor.ts";
import {
  HALL,
  HALL_SEAT,
  HUB,
  MODULE_X,
  ROOM_DOOR,
  ROOM_OFFSET,
  ROOM_SIZE,
  roomView,
  VAULT_DOOR,
  vaultDoorOpenOutline,
} from "../src/interior/stationLayout.ts";

test("first opening is claimed once", () => {
  vaultDoor.resetForTests();
  assert.equal(vaultDoor.isOpen(), false);
  assert.equal(vaultDoor.claimFirstOpening(), true);
  assert.equal(vaultDoor.claimFirstOpening(), false);
});

test("door stays open after first opening", () => {
  vaultDoor.resetForTests();
  vaultDoor.claimFirstOpening();
  assert.equal(vaultDoor.isOpen(), true);
  assert.equal(vaultDoor.isOpen(), true);
});

const BUILDINGS = [
  { id: "planner", name: "Mission Control" },
  { id: "finance", name: "The Vault" },
  { id: "jobs", name: "Opportunity Office" },
  { id: "career", name: "Flight School" },
] as const;
const TODAY = new Date(2026, 10, 16);

test("excludes planner and finance from the list", () => {
  const rows = hallwayStatus([...BUILDINGS], new Set(["planner"]));
  assert.deepEqual(
    rows.map((r) => r.id),
    ["jobs", "career"],
  );
});

test("unbuilt buildings read Under construction", () => {
  const rows = hallwayStatus([...BUILDINGS], new Set(["planner"]));
  assert.ok(rows.every((r) => r.text === "Under construction"));
});

test("built buildings read Ready", () => {
  const rows = hallwayStatus([...BUILDINGS], new Set(["planner", "jobs"]));
  assert.equal(rows.find((r) => r.id === "jobs")?.text, "Ready");
});

test("Mission Control summary shows counts, never amounts", () => {
  const tasks = [
    { status: "open", goal_date: "2026-11-01", stale: false },
    { status: "open", goal_date: null, stale: false },
  ] as const;
  const s = hallwayStatus.missionSummary([...tasks], TODAY);
  assert.equal(s, "1 overdue · 2 open");
  assert.doesNotMatch(s, /\$/);
});

test("Mission Control summary with nothing open", () => {
  assert.equal(hallwayStatus.missionSummary([], TODAY), "Nothing open");
});

test("opening time is remembered once scheduled", () => {
  vaultDoor.resetForTests();
  assert.equal(vaultDoor.openingStart(), null);
  vaultDoor.claimFirstOpening();
  vaultDoor.scheduleOpening(1234);
  assert.equal(vaultDoor.openingStart(), 1234);
});

test("with reduced motion the door is simply open (no opening plays)", () => {
  const now = 100_000;
  assert.equal(vaultDoor.openingTimeFor(now, false), now);
  const start = vaultDoor.openingTimeFor(now, true);
  assert.ok(now - start >= 6200, "the whole opening is already in the past");
});

test("open vault door clears the back wall, camera and desk", () => {
  const room = new THREE.Vector3(MODULE_X.finance, 0, 0).add(ROOM_OFFSET);
  const cam = room.clone().add(roomView("finance").camera);
  const monitor = room.clone().add(roomView("finance").screen);
  const corners = vaultDoorOpenOutline();
  assert.equal(corners.length, 4);
  for (const c of corners) {
    assert.ok(c.z > ROOM_SIZE.back + 0.05, "before the back wall");
    assert.ok(c.x >= VAULT_DOOR.x - 0.01, "swings into the room, not the hallway");
    assert.ok(Math.hypot(c.x - cam.x, c.z - cam.z) > 0.5, "clear of the camera");
    assert.ok(c.z < monitor.z - 1.0, "well away from the desk");
  }
});

test("vault door hinges on the hallway's back (-z) edge", () => {
  assert.ok(VAULT_DOOR.radius <= 0.76);
  assert.equal(VAULT_DOOR.hingeZ, HALL.z - VAULT_DOOR.radius);
});

test("hallway seat is inside the hallway, before the door", () => {
  assert.ok(HALL_SEAT.x < VAULT_DOOR.x - 0.5 && HALL_SEAT.x > HALL.startX);
  assert.ok(HALL_SEAT.z < HALL.z && Math.abs(HALL_SEAT.z - HALL.z) < HALL.width / 2);
});

test("hallway is wide enough for the seat", () => {
  assert.ok(HALL.width >= 2.3);
  assert.ok(Math.abs(HALL_SEAT.z - HALL.z) >= 0.9, "out of the camera's path");
  assert.ok(HALL.width / 2 - Math.abs(HALL_SEAT.z - HALL.z) >= 0.15, "clear of the wall");
});

test("hub sides are wide enough for the hallway openings and their frames", () => {
  const side = 2 * HUB.radius * Math.tan(Math.PI / 8);
  assert.ok(side >= HALL.width + 0.16, `hub side ${side} too narrow`);
  assert.ok(HALL.startX < HUB.radius, "hallway starts inside the hub wall");
});

test("room doorways are wider than the hallway", () => {
  assert.ok(ROOM_DOOR.half > HALL.width / 2);
  assert.ok(ROOM_DOOR.top < ROOM_SIZE.height && ROOM_DOOR.top <= HALL.height);
});
