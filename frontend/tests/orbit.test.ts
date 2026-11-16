// Tests for asteroid orbits: where each building's asteroid is at time t. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASTEROIDS,
  ORBIT_R,
  ORBIT_SPEED,
  orbitAngle,
  orbitPosition,
} from "../src/belt/space/orbit.ts";

const close = (a: number, b: number, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${a} is not close to ${b}`);

test("the seven asteroid buildings, each once, with their tint and starting angle", () => {
  assert.deepEqual(
    ASTEROIDS.map((a) => [a.id, a.tint, a.angleDeg]),
    [
      ["jobs", "#41c9d6", 347],
      ["mail", "#ffb547", 38],
      ["gym", "#ff5d6c", 89],
      ["projects", "#ff7a45", 141],
      ["relationships", "#ff7ab8", 192],
      ["career", "#9b7bff", 244],
      ["library", "#55d39a", 295],
    ],
  );
});

test("constants match the approved prototype", () => {
  assert.equal(ORBIT_R, 38);
  assert.equal(ORBIT_SPEED, 0.02);
});

test("angle starts at the asteroid's own angle and grows with time", () => {
  close(orbitAngle(0, 0, 0.02), 0);
  close(orbitAngle(90, 0, 0.02), Math.PI / 2);
  close(orbitAngle(0, 10, 0.02), 0.2);
});

test("after one full period the asteroid is back where it started", () => {
  const period = (2 * Math.PI) / ORBIT_SPEED;
  const [x0, , z0] = orbitPosition(141, 0, ORBIT_SPEED);
  const [x1, , z1] = orbitPosition(141, period, ORBIT_SPEED);
  close(x0, x1, 1e-6);
  close(z0, z1, 1e-6);
});

test("every position sits on the ring (flat plane, radius ORBIT_R)", () => {
  for (const { angleDeg } of ASTEROIDS) {
    for (const t of [0, 7.5, 123, 9999]) {
      const [x, y, z] = orbitPosition(angleDeg, t, ORBIT_SPEED);
      close(Math.hypot(x, z), ORBIT_R);
      assert.ok(Math.abs(y) <= 0.25 + 1e-9, "gentle bob only, same plane for all");
    }
  }
});
