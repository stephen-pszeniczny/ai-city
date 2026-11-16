// Tests for the unsaved-changes guard shared by every way of leaving a screen. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import { confirmLeave, isDirty, setDirty } from "../src/leaveGuard.ts";

test("clean: leaves without asking", () => {
  setDirty(false);
  let asked = false;
  assert.equal(
    confirmLeave(() => {
      asked = true;
      return false;
    }),
    true,
  );
  assert.equal(asked, false);
});

test("dirty: asks, and the answer decides", () => {
  setDirty(true);
  const messages: string[] = [];
  assert.equal(
    confirmLeave((m) => {
      messages.push(m);
      return false;
    }),
    false,
  );
  assert.equal(
    confirmLeave(() => true),
    true,
  );
  assert.deepEqual(messages, ["Discard your unsaved changes?"]);
  setDirty(false);
});

test("isDirty reports the current state", () => {
  setDirty(true);
  assert.equal(isDirty(), true);
  setDirty(false);
  assert.equal(isDirty(), false);
});
