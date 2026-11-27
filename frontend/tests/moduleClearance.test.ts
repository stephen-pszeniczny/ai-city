// Tests that the station modules' growth stays out of the way: of each other, of
// what the station already has, of the camera's flights, and in the control rooms
// of the robot, its desk, its screen and the window. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import { asteroidApproach } from "../src/belt/flightPath.ts";
import { DECK_Y } from "../src/belt/growth/deck.ts";
import { orbitPosition } from "../src/belt/space/orbit.ts";
import { roomPose, routeBetween, routeIn, routeOut, type Route } from "../src/belt/stationRoute.ts";
import { greetingAt, greetingPoints } from "../src/interior/vaultGreeting.ts";
import { DESK_SPOT } from "../src/interior/workspace.ts";
import {
  doorSide,
  FLOOR_Y,
  MODULE_X,
  ROBOT_HOVER,
  ROOM_OFFSET,
  ROOM_SIZE,
  roomView,
  VAULT_DOOR,
  VAULT_GREETING,
} from "../src/interior/stationLayout.ts";
import { crosses, solidOf, type Solid } from "./collide.ts";
import { shown } from "./growthStub.ts";
import { makeRoom, makeStation, MODULES, type Module } from "./moduleStub.ts";

/** Solid parts only: beams, scanning lights and holograms may cross things. */
const isSolid = (o: THREE.Object3D): o is THREE.Mesh =>
  (o as THREE.Mesh).isMesh &&
  !(o as THREE.InstancedMesh).isInstancedMesh &&
  ((o as THREE.Mesh).material as THREE.Material).blending !== THREE.AdditiveBlending &&
  !o.userData.reaches;

function solidsUnder(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (isSolid(o)) out.push(o);
  });
  return out;
}

// --- Outside -------------------------------------------------------------------

type Part = { mesh: THREE.Mesh; unit: string };

/** Pairs built onto each other on purpose. */
const MOUNTS = [
  ["finance.armourPlates", "finance.goldBeaconRing"], // its struts end on the plates
  ["finance.armourPlates", "finance.goldDome"],
  ["finance.armourPlates", "finance.secureDock"],
  ["finance.armourPlates", "finance.solarWings"],
  ["finance.armouredShuttle", "finance.secureDock"],
  ["finance.goldDome", "finance.goldTrimLights"],
  ["finance.goldTrimLights", "finance.secureDock"],
  ["planner.beaconTower", "planner.hullLights"],
  ["planner.dockingPort", "planner.hullLights"],
  ["planner.dockingPort", "planner.parkedShuttle"],
  ["planner.extraAntenna", "planner.hullLights"],
].map((pair) => pair.join(" through "));

/**
 * Whether this part of the station is one of the hulls pieces are bolted to: a
 * module's own body, end caps and hull bands (and the radiator the dome rises through).
 */
function isHull(unit: string, mesh: THREE.Mesh): boolean {
  const module = unit.split(".")[0] as Module;
  if (mesh.parent?.name !== `module-${module}`) return false;
  const size = new THREE.Box3().setFromObject(mesh).getSize(new THREE.Vector3());
  // Round about the module's axis: the body, its caps, rings and bands.
  const round = Math.abs(size.y - size.z) < 0.05 && size.y > 3.5;
  const radiatorStrut = size.x < 0.2 && size.z < 0.2;
  const radiator = unit === "finance.goldDome" && size.x > 5 && size.y < 0.7;
  return round || radiator || (radiatorStrut && unit === "finance.armourPlates");
}

test("no new part of a module passes through another, or through the station", () => {
  const { station, growth } = makeStation();
  for (const id of MODULES) station.moduleAnchors[id].name = `module-${id}`;
  const base = solidsUnder(station.group);
  for (const id of MODULES) growth[id].setTier(10);
  const parts: Part[] = MODULES.flatMap((id) =>
    growth[id].pieces.children.flatMap((root) =>
      solidsUnder(root).map((mesh) => ({ mesh, unit: `${id}.${root.name}` })),
    ),
  );
  const found = new Set<string>();
  const still = new Map<THREE.Mesh, { pose: string; solid: Solid }>();
  const solid = (mesh: THREE.Mesh) => {
    const pose = mesh.matrixWorld.elements.map((v) => v.toFixed(4)).join();
    let kept = still.get(mesh);
    if (kept?.pose !== pose) still.set(mesh, (kept = { pose, solid: solidOf(mesh) }));
    return kept.solid;
  };
  const boxOf = (mesh: THREE.Mesh) => {
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    return mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld);
  };
  // A few minutes of the satellite's orbit, the drones' laps and the end wings' tilt.
  for (let i = 0; i < 150; i++) {
    const t = i * 0.79;
    for (const id of MODULES) growth[id].update(t);
    station.update(t);
    station.group.updateMatrixWorld(true);
    const others: Part[] = [...parts, ...base.map((mesh) => ({ mesh, unit: "station" }))];
    const boxes = others.map((p) => boxOf(p.mesh));
    parts.forEach((mine, a) => {
      for (let b = a + 1; b < others.length; b++) {
        const other = others[b]!;
        if (other.unit === mine.unit) continue;
        const pair = [mine.unit, other.unit].sort().join(" through ");
        if (found.has(pair) || MOUNTS.includes(pair)) continue;
        if (!boxes[a]!.intersectsBox(boxes[b]!)) continue;
        if (other.unit === "station" && isHull(mine.unit, other.mesh)) continue;
        if (crosses(solid(mine.mesh), solid(other.mesh))) found.add(pair);
      }
    });
  }
  assert.deepEqual([...found].sort(), []);
});

test("the way in through the hatch stays open, and nothing reaches the asteroids", () => {
  const { station, growth } = makeStation();
  for (const id of MODULES) growth[id].setTier(10);
  const v = new THREE.Vector3();
  let widest = 0;
  for (let i = 0; i < 60; i++) {
    for (const id of MODULES) growth[id].update(i * 0.79);
    station.group.updateMatrixWorld(true);
    for (const id of MODULES) {
      for (const mesh of solidsUnder(growth[id].pieces)) {
        const p = mesh.geometry.attributes.position as THREE.BufferAttribute;
        for (let k = 0; k < p.count; k++) {
          v.fromBufferAttribute(p, k).applyMatrix4(mesh.matrixWorld);
          widest = Math.max(widest, Math.hypot(v.x, v.z));
          assert.ok(!(Math.abs(v.x) < 4 && v.z > 2 && v.z < 10), `${id}: at the hatch`);
          assert.ok(Math.abs(v.x) > 3, `${id}: at the hub`);
        }
      }
    }
  }
  // The ring is 38 out and an asteroid's growth reaches 14 from its middle.
  assert.ok(widest < 20, `reaches ${widest.toFixed(1)}`);
});

/**
 * The new parts' surfaces as points about 0.2 apart, everywhere they go. Moving parts
 * are posed every 0.4 s, over more than a full orbit of the satellite, sweep of the
 * dish and lap of the drones, so nothing slips through a gap between poses.
 */
let grid_: ReturnType<typeof buildSurfaceGrid> | undefined;
const surfaceGrid = () => (grid_ ??= buildSurfaceGrid());

function buildSurfaceGrid() {
  const { station, growth } = makeStation();
  for (const id of MODULES) growth[id].setTier(10);
  const CELL = 1.05; // at least the furthest anything asks about
  const grid = new Map<string, { p: THREE.Vector3; unit: string }[]>();
  const seen = new Set<string>();
  const cell = (p: THREE.Vector3, dx = 0, dy = 0, dz = 0) =>
    `${Math.floor(p.x / CELL) + dx},${Math.floor(p.y / CELL) + dy},${Math.floor(p.z / CELL) + dz}`;
  const add = (p: THREE.Vector3, unit: string) => {
    const key = `${unit},${Math.round(p.x * 6)},${Math.round(p.y * 6)},${Math.round(p.z * 6)}`;
    if (seen.has(key)) return;
    seen.add(key);
    let list = grid.get(cell(p));
    if (!list) grid.set(cell(p), (list = []));
    list.push({ p, unit });
  };
  const posed = new Map<THREE.Mesh, string>();
  for (let k = 0; k <= 100; k++) {
    const t = k * 0.4;
    for (const id of MODULES) growth[id].update(t);
    station.group.updateMatrixWorld(true);
    for (const id of MODULES) {
      for (const root of growth[id].pieces.children) {
        for (const mesh of solidsUnder(root)) {
          const pose = mesh.matrixWorld.elements.map((v) => v.toFixed(2)).join();
          if (posed.get(mesh) === pose) continue; // hasn't moved since it was last sampled
          posed.set(mesh, pose);
          for (const { t: tri } of solidOf(mesh).triangles) {
            const longest = Math.max(
              tri.a.distanceTo(tri.b),
              tri.b.distanceTo(tri.c),
              tri.c.distanceTo(tri.a),
            );
            const n = Math.ceil(longest / 0.2) || 1;
            const [ab, ac] = [tri.b.clone().sub(tri.a), tri.c.clone().sub(tri.a)];
            for (let i = 0; i <= n; i++) {
              for (let j = 0; j <= n - i; j++) {
                const p = tri.a.clone().addScaledVector(ab, i / n);
                add(p.addScaledVector(ac, j / n), `${id}.${root.name}`);
              }
            }
          }
        }
      }
    }
  }
  const bounds = new THREE.Box3();
  for (const list of grid.values()) for (const q of list) bounds.expandByPoint(q.p);
  /** The part within `reach` of `at`, if any. */
  return (at: THREE.Vector3, reach: number): string | null => {
    if (bounds.distanceToPoint(at) >= reach) return null; // most of a flight is nowhere near
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const near = grid.get(cell(at, dx, dy, dz));
          const hit = near?.find((q) => q.p.distanceTo(at) < reach);
          if (hit) return hit.unit;
        }
      }
    }
    return null;
  };
}

/** The camera is showing the station's inside here, so the outside is hidden (BeltScene). */
const insideBox = (c: THREE.Vector3) =>
  Math.abs(c.x) < 12.9 && c.y > -1.3 && c.y < 2.2 && Math.abs(c.z) < 2.55;

// These views only. Sampled much more finely, some from the nearest zoom behind the
// station (24 to 28 out, 25 to 40 degrees up) do pass within 0.65 of a tall new part.
test("no flight into or out of the station comes near a new part, from the sampled views", () => {
  const near = surfaceGrid();
  const found = new Set<string>();
  const fly = (route: Route, name: string) => {
    for (let i = 0; i <= 300; i++) {
      const at = route.sample((i / 300) * route.duration).position;
      if (insideBox(at)) continue;
      const hit = near(at, 0.65);
      if (hit) found.add(`${name}: ${hit}`);
    }
  };
  const rad = (d: number) => (d * Math.PI) / 180;
  for (const distance of [24, 32, 45, 82, 320]) {
    for (const elevation of [5, 16, 35, 60, 85]) {
      for (let bearing = 0; bearing < 360; bearing += 20) {
        const [e, a] = [rad(elevation), rad(bearing)];
        const from = {
          position: new THREE.Vector3(
            distance * Math.cos(e) * Math.sin(a),
            distance * Math.sin(e),
            distance * Math.cos(e) * Math.cos(a),
          ),
          target: new THREE.Vector3(),
        };
        const spot = `${distance}/${elevation}/${bearing}`;
        for (const room of MODULES) {
          fly(routeIn(room, from, { stopAtDoor: false }), `in ${room} from ${spot}`);
          fly(routeOut(room, roomPose(room), from), `out of ${room} to ${spot}`);
        }
      }
    }
  }
  assert.deepEqual([...found], []);
});

test("no flight from the belt to an asteroid comes near a new part", () => {
  const near = surfaceGrid();
  const found = new Set<string>();
  const rad = (d: number) => (d * Math.PI) / 180;
  const up = new THREE.Vector3(0, 1, 0);
  // Every asteroid can be flown to and they all orbit, so the destination goes all round
  // the ring.
  for (let angle = 0; angle < 360; angle += 10) {
    const here = new THREE.Vector3(...orbitPosition(angle, 0, 0)).setY(DECK_Y);
    // The nearer belt views: from further out the flights pass well clear.
    for (const distance of [24, 32, 45]) {
      for (const elevation of [5, 16, 35, 60]) {
        for (let bearing = 0; bearing < 360; bearing += 20) {
          for (let spin = 0; spin < 360; spin += 45) {
            const [e, b] = [rad(elevation), rad(bearing)];
            const from = {
              position: new THREE.Vector3(
                distance * Math.cos(e) * Math.cos(b),
                distance * Math.sin(e),
                distance * Math.cos(e) * Math.sin(b),
              ),
              target: new THREE.Vector3(),
            };
            const onDeck = (v: THREE.Vector3) => v.clone().applyAxisAngle(up, rad(spin)).add(here);
            const goal = { position: onDeck(DESK_SPOT.camera), target: onDeck(DESK_SPOT.screen) };
            const turn = {};
            for (let i = 0; i <= 60; i++) {
              const at = asteroidApproach(from, goal, i / 60, turn).position;
              if (at.length() > 24) continue; // further out than anything on the station
              const hit = near(at, 1.0); // the same bar as the station as it was
              if (hit) {
                found.add(`ring ${angle} from ${distance}/${elevation}/${bearing}/${spin}: ${hit}`);
              }
            }
          }
        }
      }
    }
  }
  assert.deepEqual([...found], []);
});

test("everything outside hides with the station, so inside and outside never show at once", () => {
  const { station, growth } = makeStation();
  for (const id of MODULES) {
    growth[id].setTier(10);
    let o: THREE.Object3D | null = growth[id].pieces;
    while (o && o !== station.group) o = o.parent;
    assert.equal(o, station.group, id);
    const r = makeRoom(id);
    r.interior.setTier(10);
    // The room's own pieces never reach outside the room, where the belt would show them.
    r.room.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(r.interior.pieces);
    const x = MODULE_X[id];
    assert.ok(box.min.x > x - ROOM_SIZE.width / 2 - 0.05, `${id} ${box.min.x}`);
    assert.ok(box.max.x < x + ROOM_SIZE.width / 2 + 0.05, `${id} ${box.max.x}`);
    assert.ok(box.min.z > ROOM_SIZE.back && box.max.z < ROOM_SIZE.front - 0.07, `${id} z`);
    assert.ok(box.min.y > FLOOR_Y - 0.05 && box.max.y < FLOOR_Y + ROOM_SIZE.height, `${id} y`);
  }
});

// --- The control rooms ---------------------------------------------------------

/** A control room at tier 10, with a point-maker for its own coordinates. */
function grownRoom(id: Module) {
  const r = makeRoom(id);
  r.interior.setTier(10);
  r.room.updateMatrixWorld(true);
  const at = (x: number, y: number, z: number) => r.room.localToWorld(new THREE.Vector3(x, y, z));
  return { ...r, at };
}

const TIMES = Array.from({ length: 40 }, (_, i) => i * 0.63);

for (const id of MODULES) {
  test(`${id}: nothing new comes between the camera and the screen, robot, desk or window`, () => {
    const r = grownRoom(id);
    const view = roomView(id);
    const targets: THREE.Vector3[] = [];
    const turn = new THREE.Quaternion().setFromEuler(view.turn);
    for (const x of [-0.64, -0.32, 0, 0.32, 0.64]) {
      for (const y of [-0.4, 0, 0.4]) {
        const p = new THREE.Vector3(x, y, 0).applyQuaternion(turn).add(view.screen);
        targets.push(r.at(p.x, p.y, p.z));
      }
    }
    for (const x of [-0.3, 0, 0.3]) {
      for (const y of [0.45, 0.8, 1.1, 1.4]) targets.push(r.at(x, y, 0));
    }
    for (const x of [-0.95, 0, 0.95]) {
      for (const y of [0.1, 0.76, 1.0]) targets.push(r.at(x, y, 0.5));
    }
    // The window: the whole of the front wall's glass, corner to corner.
    for (let i = 0; i <= 12; i++) {
      for (let j = 0; j <= 8; j++) {
        targets.push(r.at(-2.05 + (i * 4.1) / 12, 0.36 + (j * 2.28) / 8, ROOM_SIZE.front));
      }
    }
    const ray = new THREE.Raycaster();
    const solids = () => solidsUnder(r.interior.pieces).filter(shown);
    for (const eye of [view.camera, view.screenCamera]) {
      const from = r.at(eye.x, eye.y, eye.z);
      for (const t of TIMES.slice(0, 12)) {
        r.interior.update(t);
        r.room.updateMatrixWorld(true);
        const meshes = solids();
        for (const to of targets) {
          const along = to.clone().sub(from);
          ray.set(from, along.clone().normalize());
          ray.far = along.length() - 0.02;
          const hit = ray.intersectObjects(meshes, false)[0];
          assert.ok(!hit, `blocked by ${hit?.object.parent?.name} on the way to ${to.toArray()}`);
        }
      }
    }
  });

  test(`${id}: new things stay clear of the desk, the chair and the camera's way in`, () => {
    const r = grownRoom(id);
    const origin = new THREE.Vector3(MODULE_X[id], 0, 0).add(ROOM_OFFSET);
    const routes: Route[] = [
      routeIn(
        id,
        { position: new THREE.Vector3(0, 22, 78), target: new THREE.Vector3() },
        {
          stopAtDoor: id === "finance",
        },
      ),
      routeOut(id, roomPose(id), {
        position: new THREE.Vector3(0, 22, 78),
        target: new THREE.Vector3(),
      }),
      routeBetween(id, id === "planner" ? "finance" : "planner", roomPose(id), {
        stopAtDoor: false,
      }),
    ];
    const path = routes.flatMap((route) =>
      Array.from({ length: 501 }, (_, i) => route.sample((i / 500) * route.duration).position),
    );
    const v = new THREE.Vector3();
    let desk = 0;
    let camera = Infinity;
    for (const t of TIMES.slice(0, 10)) {
      r.interior.update(t);
      r.room.updateMatrixWorld(true);
      for (const mesh of solidsUnder(r.interior.pieces)) {
        const p = mesh.geometry.attributes.position as THREE.BufferAttribute;
        const box = new THREE.Box3().setFromObject(mesh);
        for (const eye of path) camera = Math.min(camera, box.distanceToPoint(eye));
        for (let k = 0; k < p.count; k++) {
          v.fromBufferAttribute(p, k).applyMatrix4(mesh.matrixWorld).sub(origin);
          // The console, and the space the robot and its chair turn in.
          const atConsole = Math.abs(v.x) < 0.98 && v.y < 1.5 && v.z > 0.25 && v.z < 1.2;
          const atChair = Math.hypot(v.x, v.z) < 0.7 && v.y < 1.6;
          if (atConsole || atChair) desk++;
        }
      }
    }
    assert.equal(desk, 0);
    assert.ok(camera > 0.45, `the camera passes ${camera.toFixed(2)} from something new`);
  });

  test(`${id}: what's new on the walls and floor is in the room camera's view`, () => {
    const r = grownRoom(id);
    const view = roomView(id);
    const camera = new THREE.PerspectiveCamera(55, 1.6, 0.1, 100);
    camera.position.copy(r.at(view.camera.x, view.camera.y, view.camera.z));
    camera.lookAt(r.at(view.screen.x, view.screen.y, view.screen.z));
    camera.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    for (const piece of r.interior.pieces.children) {
      let seen = 0;
      let total = 0;
      for (const mesh of solidsUnder(piece)) {
        const p = mesh.geometry.attributes.position as THREE.BufferAttribute;
        for (let k = 0; k < p.count; k++) {
          v.fromBufferAttribute(p, k).applyMatrix4(mesh.matrixWorld).project(camera);
          total++;
          if (Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z < 1) seen++;
        }
      }
      assert.ok(
        seen / total > 0.4,
        `${piece.name}: only ${Math.round((100 * seen) / total)}% seen`,
      );
    }
    assert.equal(doorSide(id), id === "planner" ? 1 : -1);
  });
}

test("the Vault robot's way in from the door stays clear of what's new in its room", () => {
  const r = grownRoom("finance");
  const origin = new THREE.Vector3(MODULE_X.finance, FLOOR_Y, 0);
  const points = greetingPoints();
  const boxes = solidsUnder(r.interior.pieces).map((m) => new THREE.Box3().setFromObject(m));
  let closest = Infinity;
  for (let i = 0; i <= 300; i++) {
    const frame = greetingAt((i / 300) * VAULT_GREETING.seated, points);
    const body = frame.robot.position.clone().add(origin);
    body.y += ROBOT_HOVER + 0.7;
    for (const box of boxes) closest = Math.min(closest, box.distanceToPoint(body));
  }
  assert.ok(closest > 0.45, `the robot passes ${closest.toFixed(2)} from something new`);
});

test("the gold finish keeps to the vault door's face, clear of its frame", () => {
  const r = grownRoom("finance");
  const box = new THREE.Box3().setFromObject(r.interior.door);
  const R = VAULT_DOOR.radius;
  assert.ok(box.max.y <= R && box.min.y >= -R, "within the round door");
  assert.ok(box.max.z <= R && box.min.z >= -R, "within the round door");
  const face = -VAULT_DOOR.thickness / 2;
  assert.ok(box.max.x <= face + 0.001, `on the outer face ${box.max.x}`);
  // Where the wheel turns (its rim is 0.32 out, from about 0.04 proud of the face).
  const v = new THREE.Vector3();
  for (const mesh of solidsUnder(r.interior.door)) {
    const p = mesh.geometry.attributes.position as THREE.BufferAttribute;
    for (let k = 0; k < p.count; k++) {
      v.fromBufferAttribute(p, k);
      if (Math.hypot(v.y, v.z) < 0.36) assert.ok(v.x > face - 0.052, `into the wheel ${v.x}`);
    }
  }
});
