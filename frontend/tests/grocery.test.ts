// Tests for the grocery list helpers. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { GroceryList } from "../src/api.ts";
import { itemCountLabel, tickedCount } from "../src/plan/grocery.ts";

test("itemCountLabel", () => {
  assert.equal(itemCountLabel(0), "empty");
  assert.equal(itemCountLabel(1), "1 item");
  assert.equal(itemCountLabel(6), "6 items");
});

test("tickedCount", () => {
  const list: GroceryList = {
    items: [
      { id: 1, name: "Eggs", ticked: false },
      { id: 2, name: "Rice", ticked: true },
      { id: 3, name: "Milk", ticked: true },
    ],
    open: 1,
  };
  assert.equal(tickedCount(list), 2);
  assert.equal(tickedCount({ items: [], open: 0 }), 0);
});
