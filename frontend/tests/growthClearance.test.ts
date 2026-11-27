// Tests that moving growth never passes through other growth, and that the curved
// flights to and from an asteroid stay clear of everything on it. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import { asteroidApproach, type Pose } from "../src/belt/flightPath.ts";
import { DECK_Y } from "../src/belt/growth/deck.ts";
import { ASTEROIDS as RING, orbitPosition } from "../src/belt/space/orbit.ts";
import { createStation } from "../src/belt/station.ts";
import { DESK_SPOT } from "../src/interior/workspace.ts";
import { ASTEROIDS, make, shown, stubKit, type Asteroid } from "./growthStub.ts";

type Part = { mesh: THREE.Mesh; unit: string; path: string };

/** Solid parts only: beams, rings of signal and other light effects may cross things. */
function partsOf(a: ReturnType<typeof make>): Part[] {
  const out: Part[] = [];
  const units = [...a.growth.pieces.children, a.growth.landmark()];
  for (const root of units) {
    const unit = root.name;
    if (unit === "signalRings") continue;
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as THREE.Material;
      if (material.blending === THREE.AdditiveBlending) return;
      // The station beam's pulses are light too; the ship in flight is solid.
      if (o.userData.reaches && unit !== "shipLaunch") return;
      out.push({ mesh, unit, path: `${unit}/${out.length}` });
    });
  }
  return out;
}

type Solid = { box: THREE.Box3; triangles: { t: THREE.Triangle; box: THREE.Box3 }[] };

function solidOf(mesh: THREE.Mesh): Solid {
  const p = mesh.geometry.attributes.position as THREE.BufferAttribute;
  const index = mesh.geometry.index;
  const count = index ? index.count : p.count;
  const corner = (k: number) =>
    new THREE.Vector3()
      .fromBufferAttribute(p, index ? index.getX(k) : k)
      .applyMatrix4(mesh.matrixWorld);
  const box = new THREE.Box3();
  const triangles = [];
  for (let k = 0; k < count; k += 3) {
    const t = new THREE.Triangle(corner(k), corner(k + 1), corner(k + 2));
    const own = new THREE.Box3().setFromPoints([t.a, t.b, t.c]);
    box.union(own);
    triangles.push({ t, box: own });
  }
  return { box, triangles };
}

const ray = new THREE.Ray();
const hit = new THREE.Vector3();
function edgeCrosses(from: THREE.Vector3, to: THREE.Vector3, t: THREE.Triangle): boolean {
  const length = from.distanceTo(to);
  if (length < 1e-6) return false;
  ray.origin.copy(from);
  ray.direction.copy(to).sub(from).divideScalar(length);
  return !!ray.intersectTriangle(t.a, t.b, t.c, false, hit) && hit.distanceTo(from) <= length;
}

function crosses(one: Solid, two: Solid): boolean {
  const shared = one.box.clone().intersect(two.box);
  if (shared.isEmpty()) return false;
  const near = (s: Solid) => s.triangles.filter((x) => x.box.intersectsBox(shared));
  const [ones, twos] = [near(one), near(two)];
  for (const x of ones) {
    for (const y of twos) {
      if (!x.box.intersectsBox(y.box)) continue;
      for (const [p, q] of [
        [x.t, y.t],
        [y.t, x.t],
      ] as const) {
        if (edgeCrosses(p.a, p.b, q) || edgeCrosses(p.b, p.c, q) || edgeCrosses(p.c, p.a, q)) {
          return true;
        }
      }
    }
  }
  return false;
}

/** The relay is built onto the moonlet. */
const mounted = (x: string, y: string) =>
  [x, y].sort().join() === ["moonlet", "moonletRelay"].sort().join();

const TIMES = Array.from({ length: 300 }, (_, i) => i * 0.73);

/** Every pair of pieces where a moving part passes through another piece, over a few minutes. */
function collisions(id: Asteroid, tier: number): string[] {
  const a = make(id);
  a.growth.setTier(tier);
  const parts = partsOf(a);
  // A part "moves" if it ever changes place or turns (pulsing lamps don't count).
  const poses = () =>
    parts.map((p) => {
      const at = new THREE.Vector3();
      const turn = new THREE.Quaternion();
      p.mesh.matrixWorld.decompose(at, turn, new THREE.Vector3());
      return [...at.toArray(), ...turn.toArray()];
    });
  const place = (t: number) => {
    a.growth.update(t);
    a.world.updateMatrixWorld(true);
  };
  place(0);
  const first = poses();
  const moving = new Set<number>();
  for (const t of TIMES.filter((_, i) => i % 5 === 1)) {
    place(t);
    poses().forEach((pose, i) => {
      if (pose.some((v, k) => Math.abs(v - first[i]![k]!) > 1e-5)) moving.add(i);
    });
  }
  const still = new Map<number, Solid>();
  const found = new Set<string>();
  for (const t of TIMES) {
    place(t);
    const now = new Map<number, Solid>();
    const bounds = new THREE.Box3();
    const solid = (i: number) => {
      const store = moving.has(i) ? now : still;
      let s = store.get(i);
      if (!s) store.set(i, (s = solidOf(parts[i]!.mesh)));
      return s;
    };
    const boxes = parts.map((p) => {
      p.mesh.geometry.boundingBox ?? p.mesh.geometry.computeBoundingBox();
      return bounds.copy(p.mesh.geometry.boundingBox!).applyMatrix4(p.mesh.matrixWorld).clone();
    });
    for (const i of moving) {
      if (!shown(parts[i]!.mesh)) continue;
      parts.forEach((other, k) => {
        const mine = parts[i]!;
        if (other.unit === mine.unit || mounted(other.unit, mine.unit)) return;
        const pair = [mine.unit, other.unit].sort().join(" through ");
        if (found.has(pair) || !shown(other.mesh) || !boxes[i]!.intersectsBox(boxes[k]!)) return;
        if (crosses(solid(i), solid(k))) found.add(pair);
      });
    }
  }
  return [...found].sort();
}

for (const id of ASTEROIDS) {
  for (const tier of [9, 10]) {
    test(`${id} tier ${tier}: nothing that moves passes through another piece`, () => {
      assert.deepEqual(collisions(id, tier), []);
    });
  }
}

/** Belt camera spots all round an asteroid, in its deck coordinates. */
function beltSpots(): Pose[] {
  const out: Pose[] = [];
  for (const elevation of [5, 20, 35]) {
    for (let degrees = 0; degrees < 360; degrees += 15) {
      for (const distance of degrees % 30 ? [45] : [45, 80]) {
        const [e, a] = [(elevation * Math.PI) / 180, (degrees * Math.PI) / 180];
        out.push({
          position: new THREE.Vector3(
            distance * Math.cos(e) * Math.cos(a),
            distance * Math.sin(e) - DECK_Y,
            distance * Math.cos(e) * Math.sin(a),
          ),
          target: new THREE.Vector3(0, -DECK_Y, 38),
        });
      }
    }
  }
  return out;
}

/** How many approaches cross something on the asteroid, or pass within the lens's reach of it. */
function clippedApproaches(id: Asteroid, tier: number): { clipped: number; by: string[] } {
  const a = make(id);
  a.growth.setTier(tier);
  a.growth.update(0);
  a.world.updateMatrixWorld(true);
  const solids = partsOf(a)
    .filter((p) => !p.mesh.userData.reaches)
    .map((p) => ({ ...p, box: new THREE.Box3().setFromObject(p.mesh) }));
  const goal: Pose = { position: DESK_SPOT.camera.clone(), target: DESK_SPOT.screen.clone() };
  const caster = new THREE.Raycaster();
  const v = new THREE.Vector3();
  const by = new Set<string>();
  let clipped = 0;
  for (const from of beltSpots()) {
    let touched: string | null = null;
    const turn = {};
    let before = asteroidApproach(from, goal, 0, turn).position;
    for (let i = 1; i <= 100 && !touched; i++) {
      const at = asteroidApproach(from, goal, i / 100, turn).position;
      const step = at.clone().sub(before);
      const length = step.length();
      for (const s of solids) {
        // Only parts whose box the step comes near.
        if (s.box.distanceToPoint(at) > length + 0.6) continue;
        if (length > 1e-6) {
          caster.set(before, step.clone().normalize());
          caster.far = length;
          if (caster.intersectObject(s.mesh, false).length) touched = s.unit;
        }
        const p = s.mesh.geometry.attributes.position as THREE.BufferAttribute;
        for (let k = 0; k < p.count && !touched; k++) {
          if (v.fromBufferAttribute(p, k).applyMatrix4(s.mesh.matrixWorld).distanceTo(at) < 0.6) {
            touched = s.unit;
          }
        }
        if (touched) break;
      }
      before = at;
    }
    if (touched) {
      clipped++;
      by.add(touched);
    }
  }
  return { clipped, by: [...by].sort() };
}

for (const id of ASTEROIDS) {
  for (const tier of [0, 10]) {
    test(`${id} tier ${tier}: no flight in (or out) passes through anything on the asteroid`, () => {
      assert.deepEqual(clippedApproaches(id, tier), { clipped: 0, by: [] });
    });
  }
}

test("flights from belt viewpoints never come near the station", () => {
  const station = createStation(stubKit().kit);
  station.group.updateMatrixWorld(true);
  const boxes: THREE.Box3[] = [];
  station.group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) boxes.push(new THREE.Box3().setFromObject(o));
  });
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const up = new THREE.Vector3(0, 1, 0);
  let closest = Infinity;
  for (const { id, angleDeg } of RING.filter((a) => a.id === "jobs" || a.id === "career")) {
    const here = new THREE.Vector3(...orbitPosition(angleDeg, 0, 0)).setY(DECK_Y);
    // Anywhere the belt camera can be (it circles the station), for any turn of the deck.
    for (const distance of [24, 32, 45, 60, 82, 120, 320]) {
      for (const elevation of [5, 16, 35, 60, 85]) {
        for (let bearing = 0; bearing < 360; bearing += 20) {
          for (let spin = 0; spin < 360; spin += 45) {
            const [e, b] = [radians(elevation), radians(bearing)];
            const from: Pose = {
              position: new THREE.Vector3(
                distance * Math.cos(e) * Math.cos(b),
                distance * Math.sin(e),
                distance * Math.cos(e) * Math.sin(b),
              ),
              target: new THREE.Vector3(),
            };
            const onDeck = (v: THREE.Vector3) =>
              v.clone().applyAxisAngle(up, radians(spin)).add(here);
            const goal = { position: onDeck(DESK_SPOT.camera), target: onDeck(DESK_SPOT.screen) };
            const turn = {};
            for (let i = 0; i <= 60; i++) {
              const at = asteroidApproach(from, goal, i / 60, turn).position;
              if (at.length() > 30) continue;
              for (const box of boxes) closest = Math.min(closest, box.distanceToPoint(at));
            }
            assert.ok(
              closest > 1,
              `${id}: ${closest.toFixed(2)} from ${distance}/${elevation}/${bearing}`,
            );
          }
        }
      }
    }
  }
});
