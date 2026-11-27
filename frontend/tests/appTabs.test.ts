// Tests for the desk computer's left app list. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import { appListLayout, switchMode } from "../src/desktop/appTabs.ts";

test("the app list scrolls only past eight apps", () => {
  assert.equal(appListLayout(1).scroll, false);
  assert.equal(appListLayout(3).scroll, false);
  assert.equal(appListLayout(8).scroll, false);
  assert.equal(appListLayout(9).scroll, true);
});

test("switching apps is instant with Reduce Motion, a slide otherwise", () => {
  assert.equal(switchMode(true), "instant");
  assert.equal(switchMode(false), "slide");
});
