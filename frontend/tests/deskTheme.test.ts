// Tests for each desk computer's tint and desktop background. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import { deskTheme } from "../src/desktop/deskTheme.ts";

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

test("every building has a hex accent and a wallpaper that uses it", () => {
  for (const id of ALL) {
    const t = deskTheme(id);
    assert.match(t.accent, /^#[0-9a-f]{6}$/i, id);
    assert.ok(t.wallpaper.includes(t.accent), id);
  }
});

test("the built buildings look different from each other", () => {
  const accents = ["planner", "finance", "jobs", "career"].map(
    (id) => deskTheme(id as never).accent,
  );
  assert.equal(new Set(accents).size, 4);
});

test("Mission Control gets a blue-white, not its near-white station tint", () => {
  assert.equal(deskTheme("planner").accent, "#9db8ff");
});

test("the same building always gets the same theme", () => {
  assert.deepEqual(deskTheme("finance"), deskTheme("finance"));
});
