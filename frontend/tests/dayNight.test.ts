// Tests for the day/night rules: the sky override, refresh timing and the fade. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  blend,
  fadeSecondsFor,
  isNight,
  isPastChange,
  loadChoice,
  msUntilRefresh,
  saveChoice,
  SKY_CHOICES,
} from "../src/belt/dayNight.ts";
import { LOOK } from "../src/belt/look.ts";

const daylight = (is_night: boolean) => ({
  is_night,
  sunrise: null,
  sunset: null,
  next_change: "2026-06-21T21:20:00+01:00",
  moon_phase: 0.5,
});

test("the switch has three segments, in order: day, night, auto", () => {
  assert.deepEqual(SKY_CHOICES, ["day", "night", "auto"]);
});

test("auto follows the daylight answer; day and night ignore it", () => {
  assert.equal(isNight("auto", daylight(true)), true);
  assert.equal(isNight("auto", daylight(false)), false);
  assert.equal(isNight("day", daylight(true)), false);
  assert.equal(isNight("night", daylight(false)), true);
});

test("auto with no answer (engine down) is day; night override still works", () => {
  assert.equal(isNight("auto", undefined), false);
  assert.equal(isNight("night", undefined), true);
});

test("storage that throws, is null, or holds junk loads as auto", () => {
  const throwing = {
    getItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(loadChoice(throwing), "auto");
  assert.equal(loadChoice(null), "auto");
  assert.equal(loadChoice({ getItem: () => "purple" }), "auto");
  assert.equal(loadChoice({ getItem: () => null }), "auto");
});

test("a saved choice loads back", () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  saveChoice(storage, "night");
  assert.equal(loadChoice(storage), "night");
});

test("every segment's choice is remembered", () => {
  for (const choice of SKY_CHOICES) {
    let saved = "";
    saveChoice({ setItem: (_k: string, v: string) => void (saved = v) }, choice);
    assert.equal(loadChoice({ getItem: () => saved }), choice);
  }
});

test("saving to storage that throws, or no storage, doesn't throw", () => {
  const throwing = {
    setItem: () => {
      throw new Error("full");
    },
  };
  assert.doesNotThrow(() => saveChoice(throwing, "day"));
  assert.doesNotThrow(() => saveChoice(null, "day"));
});

test("a next change already in the past refreshes in one minute", () => {
  const now = Date.parse("2026-06-21T22:00:00+01:00");
  assert.equal(msUntilRefresh("2026-06-21T21:20:00+01:00", now), 60_000);
});

test("a next change a few hours away refreshes right then", () => {
  const now = Date.parse("2026-06-21T18:00:00+01:00");
  assert.equal(msUntilRefresh("2026-06-21T21:00:00+01:00", now), 3 * 3_600_000);
});

test("a far next change refreshes within six hours", () => {
  const now = Date.parse("2026-12-21T00:00:00Z");
  assert.equal(msUntilRefresh("2026-12-23T00:00:00Z", now), 21_600_000);
});

test("an unreadable next change refreshes in one minute", () => {
  assert.equal(msUntilRefresh("not a time", Date.now()), 60_000);
});

test("blend: start, middle, end, and zero fade", () => {
  assert.equal(blend(0, 1, 0, 20), 0);
  assert.equal(blend(0, 1, 10, 20), 0.5);
  assert.equal(blend(0, 1, 25, 20), 1);
  assert.equal(blend(0, 1, 5, 0), 1);
  assert.equal(blend(1, 0, 25, 20), 0);
});

test("a change from the sky switch fades quickly", () => {
  assert.equal(fadeSecondsFor("auto", "day", { fadeSeconds: 20, buttonFadeSeconds: 3 }), 3);
});

test("sunset in Auto fades slowly, even after earlier button presses", () => {
  // The choice is unchanged since last time (Auto), so the change came from the backend.
  assert.equal(fadeSecondsFor("auto", "auto", { fadeSeconds: 20, buttonFadeSeconds: 3 }), 20);
});

test("a past next change means it's time to ask again (Mac woke from sleep)", () => {
  const next = "2026-06-21T21:20:00+01:00";
  assert.equal(isPastChange(next, Date.parse("2026-06-21T23:00:00+01:00")), true);
  assert.equal(isPastChange(next, Date.parse("2026-06-21T20:00:00+01:00")), false);
  assert.equal(isPastChange("not a time", Date.now()), false);
});

test("how dark night gets lives in the look settings", () => {
  assert.equal(typeof LOOK.dayNight.nightSunStrength, "number");
  assert.equal(typeof LOOK.dayNight.nightFillStrength, "number");
});
