// Tests for switching apps from inside a panel (e.g. "Open check-in"). Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import { appExists } from "../src/desktop/openApp.ts";

const APPS = [
  { id: "todo", ready: true },
  { id: "checkin", ready: true },
  { id: "projects", ready: false },
];

test("a ready app on this computer can be opened", () => {
  assert.equal(appExists(APPS, "checkin"), true);
});

test("an app not yet built, or not on this computer, can't", () => {
  assert.equal(appExists(APPS, "projects"), false);
  assert.equal(appExists(APPS, "income"), false);
});
