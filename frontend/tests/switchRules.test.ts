// Tests for the Sample | Personal switch's wording and button rules. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import { canSwitchTo, switchStatus } from "../src/belt/switchRules.ts";

test("going to Personal says it's waiting for Touch ID", () => {
  assert.equal(switchStatus({ mode: "sample", pendingTo: "personal" }), "Waiting for Touch ID…");
});

test("going to Sample says so; nothing pending says nothing", () => {
  assert.equal(switchStatus({ mode: "personal", pendingTo: "sample" }), "Switching to Sample…");
  assert.equal(switchStatus({ mode: "sample", pendingTo: null }), null);
});

test("only the other mode can be pressed", () => {
  const state = { mode: "sample" as const, pendingTo: null };
  assert.equal(canSwitchTo("personal", state), true);
  assert.equal(canSwitchTo("sample", state), false);
});

test("nothing can be pressed while a switch is under way", () => {
  const state = { mode: "sample" as const, pendingTo: "personal" as const };
  assert.equal(canSwitchTo("personal", state), false);
  assert.equal(canSwitchTo("sample", state), false);
});

test("nothing can be pressed while the mode is unknown (engine down)", () => {
  const state = { mode: undefined, pendingTo: null };
  assert.equal(canSwitchTo("personal", state), false);
  assert.equal(canSwitchTo("sample", state), false);
});
