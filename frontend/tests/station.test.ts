// Tests for the vault door (opens once per app session) and the Mission
// Control hallway status screens (counts and status only). Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import { hallwayStatus } from "../src/belt/hallwayStatus.ts";
import { vaultDoor } from "../src/belt/vaultDoor.ts";

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
