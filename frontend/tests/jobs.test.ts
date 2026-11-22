// Tests for Opportunity Office's small display rules. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import { checkLabel, nextProjectStatuses, payText } from "../src/jobs/jobs.ts";

test("project statuses move forward, or to rejected before active", () => {
  assert.deepEqual(nextProjectStatuses("found"), [
    "applied",
    "assessment",
    "accepted",
    "active",
    "ended",
    "rejected",
  ]);
  assert.deepEqual(nextProjectStatuses("accepted"), ["active", "ended", "rejected"]);
  assert.deepEqual(nextProjectStatuses("active"), ["ended"]);
  assert.deepEqual(nextProjectStatuses("ended"), []);
  assert.deepEqual(nextProjectStatuses("rejected"), []);
});

test("check label: due, tomorrow, later, never", () => {
  assert.equal(checkLabel({ next_check_on: "2026-11-29" }, "2026-11-29"), "Due today");
  assert.equal(checkLabel({ next_check_on: "2026-11-27" }, "2026-11-29"), "Due today");
  assert.equal(checkLabel({ next_check_on: "2026-11-30" }, "2026-11-29"), "Due tomorrow");
  assert.equal(checkLabel({ next_check_on: "2026-12-02" }, "2026-11-29"), "Due in 3 days");
  assert.equal(checkLabel({ next_check_on: null }, "2026-11-29"), "—");
});

test("pay text shows the other currency when the rate is known", () => {
  const usd = { pay_cents: 4500, currency: "USD", pay_usd_cents: 4500, pay_cad_cents: 6120 };
  assert.equal(payText(usd), "$45 USD/hr · $61.20 CAD");
  const cad = { pay_cents: 5500, currency: "CAD", pay_usd_cents: 4044, pay_cad_cents: 5500 };
  assert.equal(payText(cad), "$55 CAD/hr · $40.44 USD");
  const noRate = { pay_cents: 5500, currency: "CAD", pay_usd_cents: null, pay_cad_cents: 5500 };
  assert.equal(payText(noRate), "$55 CAD/hr");
  const none = { pay_cents: null, currency: null, pay_usd_cents: null, pay_cad_cents: null };
  assert.equal(payText(none), "Pay not set");
});
