// Tests for the camera's station routes: one smooth swoop in, out and between
// the two control rooms, stopping only at the vault door the first time.
// Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import { LOOK } from "../src/belt/look.ts";
import type { Pose } from "../src/belt/flightPath.ts";
import { roomPose, routeBetween, routeIn, routeOut, type Route } from "../src/belt/stationRoute.ts";
import {
  HALL,
  HATCH,
  HUB,
  VAULT_DOOR,
  VAULT_GREETING as G,
} from "../src/interior/stationLayout.ts";

const BELT: Pose = { position: new THREE.Vector3(0, 22, 78), target: new THREE.Vector3(0, 0, 0) };
const DT = 1 / 60;
const near = (a: THREE.Vector3, b: THREE.Vector3, eps = 1e-6) => a.distanceTo(b) < eps;
const times = (r: Route) => {
  const out: number[] = [];
  for (let t = 0; t <= r.duration + 1e-9; t += DT) out.push(t);
  out.push(r.duration);
  return out;
};
const facing = (p: Pose) => p.target.clone().sub(p.position).normalize();
const held = (r: Route, t: number) =>
  r.doorStop !== null && t > r.doorStop.at - 1e-9 && t < r.doorStop.at + r.doorStop.hold + 1e-9;

const allRoutes = (): [string, Route][] => [
  ["in planner", routeIn("planner", BELT, { stopAtDoor: false })],
  ["in finance", routeIn("finance", BELT, { stopAtDoor: false })],
  ["in finance, door", routeIn("finance", BELT, { stopAtDoor: true })],
  ["out planner", routeOut("planner", roomPose("planner"), BELT)],
  ["out finance", routeOut("finance", roomPose("finance"), BELT)],
  [
    "planner → finance",
    routeBetween("planner", "finance", roomPose("planner"), { stopAtDoor: false }),
  ],
  [
    "finance → planner",
    routeBetween("finance", "planner", roomPose("finance"), { stopAtDoor: false }),
  ],
  [
    "planner → finance, door",
    routeBetween("planner", "finance", roomPose("planner"), { stopAtDoor: true }),
  ],
];

test("routes start at the given pose and end exactly on the room pose", () => {
  const cases: [Route, Pose, Pose][] = [
    [routeIn("planner", BELT, { stopAtDoor: false }), BELT, roomPose("planner")],
    [routeIn("finance", BELT, { stopAtDoor: true }), BELT, roomPose("finance")],
    [
      routeBetween("planner", "finance", roomPose("planner"), { stopAtDoor: false }),
      roomPose("planner"),
      roomPose("finance"),
    ],
    [
      routeBetween("finance", "planner", roomPose("finance"), { stopAtDoor: false }),
      roomPose("finance"),
      roomPose("planner"),
    ],
  ];
  for (const [r, from, to] of cases) {
    const a = r.sample(0);
    assert.ok(near(a.position, from.position) && near(a.target, from.target), "start");
    const b = r.sample(r.duration + 5);
    assert.ok(near(b.position, to.position, 1e-5) && near(b.target, to.target, 1e-5), "end");
  }
});

test("routeOut ends exactly on the belt pose", () => {
  for (const room of ["planner", "finance"] as const) {
    const r = routeOut(room, roomPose(room), BELT);
    const end = r.sample(r.duration);
    assert.ok(near(end.position, BELT.position, 1e-5));
    assert.ok(near(end.target, BELT.target, 1e-5));
  }
});

test("durations match LOOK", () => {
  const eq = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  assert.ok(
    eq(routeIn("planner", BELT, { stopAtDoor: false }).duration, LOOK.flights.toStationSeconds),
  );
  assert.ok(
    eq(routeOut("finance", roomPose("finance"), BELT).duration, LOOK.flights.fromStationSeconds),
  );
  assert.ok(
    eq(
      routeBetween("finance", "planner", roomPose("finance"), { stopAtDoor: false }).duration,
      LOOK.flights.roomToRoomSeconds,
    ),
  );
  const door = routeIn("finance", BELT, { stopAtDoor: true });
  assert.ok(door.doorStop !== null);
  assert.ok(door.doorStop.hold >= G.swing, "waits until the door is open");
  assert.ok(door.doorStop.at < LOOK.flights.toStationSeconds);
  // After the stop the camera glides in with the robot, arriving as it sits down.
  assert.ok(eq(door.duration, door.doorStop.at + door.doorStop.hold + (G.seated - G.swing)));
});

test("no stop-and-go", () => {
  for (const [name, r] of allRoutes()) {
    if (r.doorStop) continue;
    let prev = r.sample(0).position;
    let prevSpeed: number | null = null;
    for (const t of times(r).slice(1)) {
      const p = r.sample(t).position;
      const speed = p.distanceTo(prev) / DT;
      if (t > 0.3 && t < r.duration - 0.3)
        assert.ok(speed > 0.2, `${name}: stalls at ${t.toFixed(2)}`);
      if (prevSpeed !== null && t < r.duration - DT)
        assert.ok(
          Math.abs(speed - prevSpeed) < 1.0,
          `${name}: lurch at ${t.toFixed(2)} (${prevSpeed.toFixed(2)} → ${speed.toFixed(2)})`,
        );
      prev = p;
      prevSpeed = speed;
    }
  }
});

test("never spins", () => {
  for (const [name, r] of allRoutes()) {
    let prev = facing(r.sample(0));
    for (const t of times(r).slice(1)) {
      const pose = r.sample(t);
      const dir = facing(pose);
      const turn = THREE.MathUtils.radToDeg(dir.angleTo(prev));
      assert.ok(turn < 3, `${name}: turns ${turn.toFixed(1)}° in a frame at ${t.toFixed(2)}`);
      assert.ok(pose.target.distanceTo(pose.position) >= 1.0, `${name}: target too close at ${t}`);
      prev = dir;
    }
  }
});

test("room to room passes through the hub and stays in the hallways", () => {
  for (const [from, to] of [
    ["planner", "finance"],
    ["finance", "planner"],
  ] as const) {
    const r = routeBetween(from, to, roomPose(from), { stopAtDoor: false });
    let hub = false;
    for (const t of times(r)) {
      const p = r.sample(t).position;
      if (Math.hypot(p.x, p.z) < 1.0) hub = true;
      if (Math.abs(p.x) > HUB.radius && Math.abs(p.x) < HALL.endX)
        assert.ok(
          Math.abs(p.z - HALL.z) < HALL.width / 2 - 0.2,
          `${from}→${to}: off the hallway at ${t.toFixed(2)}`,
        );
    }
    assert.ok(hub, "passes through the hub");
  }
});

test("first vault visit stops before the door", () => {
  for (const r of [
    routeIn("finance", BELT, { stopAtDoor: true }),
    routeBetween("planner", "finance", roomPose("planner"), { stopAtDoor: true }),
  ]) {
    assert.ok(r.doorStop !== null);
    const a = r.sample(r.doorStop.at);
    const b = r.sample(r.doorStop.at + r.doorStop.hold);
    assert.ok(near(a.position, b.position) && near(a.target, b.target), "still during the hold");
    assert.ok(a.position.x < VAULT_DOOR.x - 1.2, "short of the door");
    assert.ok(facing(a).x > 0.9, "looking at the door");
  }
  assert.equal(routeIn("finance", BELT, { stopAtDoor: false }).doorStop, null);
});

test("flight in from behind the station stays outside the hull", () => {
  const behind: Pose = {
    position: new THREE.Vector3(0, 5, -40),
    target: new THREE.Vector3(0, 0, 0),
  };
  const r = routeIn("planner", behind, { stopAtDoor: false });
  const spine = (p: THREE.Vector3) =>
    Math.hypot(p.x - THREE.MathUtils.clamp(p.x, -13, 13), p.y, p.z);
  for (const t of times(r)) {
    const p = r.sample(t).position;
    if (Math.abs(p.x) < 0.6 && p.z <= HATCH.z + 0.7) break; // reached the hatch
    assert.ok(
      spine(p) > 3.0,
      `too close to the hull at ${t.toFixed(2)}: ${p.toArray().map((v) => v.toFixed(1))}`,
    );
  }
});

test("a route can start mid-hallway", () => {
  const mid: Pose = {
    position: new THREE.Vector3(5, HATCH.centreY + 0.3, 0),
    target: new THREE.Vector3(8, HATCH.centreY + 0.3, 0),
  };
  const r = routeOut("finance", mid, BELT);
  const a = r.sample(0);
  assert.ok(near(a.position, mid.position) && near(a.target, mid.target));
  let prev = facing(a);
  let prevPos = a.position;
  for (const t of times(r).slice(1)) {
    const pose = r.sample(t);
    assert.ok(THREE.MathUtils.radToDeg(facing(pose).angleTo(prev)) < 3, `spins at ${t.toFixed(2)}`);
    assert.ok(pose.position.x <= prevPos.x + 0.05, "heads back toward the hub, not into the Vault");
    prev = facing(pose);
    prevPos = pose.position;
    if (pose.position.z > HATCH.z + 1) break;
  }
});

test("routes never pass through the station's outer ring", () => {
  // The ring (station.ts): a torus of radius 6.6, tube 0.62, in the x = 0 plane round the hub.
  const RING = { radius: 6.6, tube: 0.62 };
  const behind: Pose = {
    position: new THREE.Vector3(0, 5, -40),
    target: new THREE.Vector3(0, 0, 0),
  };
  const routes: [string, Route][] = [
    ...allRoutes(),
    ["in from behind", routeIn("planner", behind, { stopAtDoor: false })],
    ["out to behind", routeOut("finance", roomPose("finance"), behind)],
  ];
  for (const [name, r] of routes) {
    for (const t of times(r)) {
      const p = r.sample(t).position;
      const fromAxis = Math.hypot(p.y, p.z);
      const toTube = Math.hypot(p.x, fromAxis - RING.radius);
      assert.ok(toTube > RING.tube + 0.3, `${name}: through the ring at ${t.toFixed(2)}`);
    }
  }
});

test("leaving or switching rooms while still outside never flies through the hull", () => {
  // Mid-way along the flight in, still outside the hatch.
  const r = routeIn("planner", BELT, { stopAtDoor: false });
  let outside = r.sample(0);
  for (const t of times(r)) {
    const p = r.sample(t);
    if (p.position.z < HATCH.z + 4) break;
    outside = p;
  }
  assert.ok(outside.position.z > HATCH.z + 3, "found a pose outside");
  const spine = (p: THREE.Vector3) =>
    Math.hypot(p.x - THREE.MathUtils.clamp(p.x, -13, 13), p.y, p.z);
  const out = routeOut("planner", outside, BELT);
  for (const t of times(out)) {
    assert.ok(spine(out.sample(t).position) > 2.5, `out: into the hull at ${t.toFixed(2)}`);
  }
  const across = routeBetween("planner", "finance", outside, { stopAtDoor: false });
  for (const t of times(across)) {
    const p = across.sample(t).position;
    if (Math.abs(p.x) < 0.6 && p.z <= HATCH.z + 0.7) break; // through the hatch: inside now
    assert.ok(spine(p) > 2.5, `between: into the hull at ${t.toFixed(2)}`);
  }
});

// --- Smooth everyday flights (Steve, 2026-11-18) -------------------------------

/** Belt views the camera may start from: the home view, turned to one side, turned away. */
const STARTS: [string, Pose][] = [
  ["home", BELT],
  ["turned", { position: new THREE.Vector3(70, 22, -38), target: new THREE.Vector3() }],
  ["other side", { position: new THREE.Vector3(-75, 30, 25), target: new THREE.Vector3() }],
  ["behind", { position: new THREE.Vector3(5, 20, -80), target: new THREE.Vector3() }],
];

/** How often the camera's turning direction flips (sway), and its fastest turn. */
function yawMotion(r: Route) {
  const n = 600;
  let prevYaw: number | null = null;
  let prevRate = 0;
  let flips = 0;
  let maxRate = 0;
  for (let i = 0; i <= n; i++) {
    const d = facing(r.sample((i / n) * r.duration));
    const yaw = Math.atan2(d.x, d.z);
    if (prevYaw !== null) {
      let step = yaw - prevYaw;
      step = Math.atan2(Math.sin(step), Math.cos(step));
      maxRate = Math.max(maxRate, (Math.abs(step) * n) / r.duration);
      if (Math.abs(step) > 2e-3) {
        if (prevRate && Math.sign(step) !== Math.sign(prevRate)) flips++;
        prevRate = step;
      }
    }
    prevYaw = yaw;
  }
  return { flips, maxRate };
}

test("no side-to-side sway: flights in and out turn smoothly", () => {
  for (const [name, start] of STARTS) {
    for (const room of ["planner", "finance"] as const) {
      const into = routeIn(room, start, { stopAtDoor: false });
      const out = routeOut(room, into.sample(into.duration), start);
      for (const [dir, r] of [
        ["in", into],
        ["out", out],
      ] as const) {
        const { flips, maxRate } = yawMotion(r);
        assert.ok(
          flips <= 2,
          `${dir} ${room} from ${name}: turning direction flips ${flips} times`,
        );
        assert.ok(
          maxRate < 1.6,
          `${dir} ${room} from ${name}: turns at ${maxRate.toFixed(2)} rad/s`,
        );
      }
    }
  }
});

test("the camera lines up with the hatch on the way in, not by circling the station", () => {
  for (const [name, start] of STARTS) {
    const r = routeIn("planner", start, { stopAtDoor: false });
    for (let i = 0; i <= 400; i++) {
      const p = r.sample((i / 400) * r.duration).position;
      const flat = Math.hypot(p.x, p.z);
      if (flat < 9) break; // reached the station: only the approach counts
      if (flat > 16) continue; // the ring just outside the station
      const around = Math.abs(Math.atan2(p.x, p.z)); // 0 = straight out from the hatch
      assert.ok(
        around < THREE.MathUtils.degToRad(35),
        `from ${name}: ${((around * 180) / Math.PI).toFixed(0)}° round the station when close`,
      );
    }
  }
});
