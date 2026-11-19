// Tests for which apps each building's desktop offers. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import { appsFor } from "../src/desktop/apps.ts";

const ALL = [
  "planner",
  "finance",
  "jobs",
  "career",
  "mail",
  "relationships",
  "projects",
  "gym",
  "library",
] as const;

test("Mission Control: To-do, Daily plan and Sunday check-in are ready; Projects comes later", () => {
  assert.deepEqual(
    appsFor("planner").map((a) => [a.id, a.name, a.ready]),
    [
      ["todo", "To-do", true],
      ["plan", "Daily plan", true],
      ["checkin", "Sunday check-in", true],
      ["projects", "Projects", false],
    ],
  );
});

test("The Vault: Income first (it opens first), then Side work and Statements", () => {
  assert.deepEqual(
    appsFor("finance").map((a) => [a.id, a.name, a.ready]),
    [
      ["income", "Income", true],
      ["sidework", "Side work", true],
      ["statements", "Statements", true],
    ],
  );
});

test("every other building shows one under-construction app, not ready", () => {
  for (const id of ALL.filter((b) => b !== "planner" && b !== "finance")) {
    assert.deepEqual(
      appsFor(id),
      [{ id: "construction", name: "Under construction", ready: false }],
      id,
    );
  }
});

test("every building offers at least one app", () => {
  for (const id of ALL) assert.ok(appsFor(id).length >= 1, id);
});
