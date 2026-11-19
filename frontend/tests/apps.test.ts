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

test("Mission Control: To-do is ready; Daily plan, Weekly review and Projects come later", () => {
  assert.deepEqual(
    appsFor("planner").map((a) => [a.id, a.name, a.ready]),
    [
      ["todo", "To-do", true],
      ["plan", "Daily plan", false],
      ["review", "Weekly review", false],
      ["projects", "Projects", false],
    ],
  );
});

test("The Vault: Side work, Income and Statements are ready", () => {
  assert.deepEqual(
    appsFor("finance").map((a) => [a.id, a.name, a.ready]),
    [
      ["sidework", "Side work", true],
      ["income", "Income", true],
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
