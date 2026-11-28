// Tests for the level-up's cargo shuttle. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import { asteroidDock } from "../src/belt/cargoRoute.ts";
import { createCargoShuttle } from "../src/belt/CargoShuttle.ts";

const dock = asteroidDock("jobs", 55, 1.6, 1);
const made = () => createCargoShuttle(dock, "#41c9d6", new THREE.Texture());
const docked = { arrive: 1, tether: 1, unload: 0.5, depart: 0 };

test("it comes in from the path's start, holds at the dock and leaves", () => {
  const cargo = made();
  cargo.update(0, { arrive: 0, tether: 0, unload: -1, depart: 0 });
  assert.ok(cargo.ship.position.distanceTo(dock.inbound.from) < 1e-6);
  cargo.update(0, docked);
  assert.ok(cargo.ship.position.distanceTo(dock.at) < 1e-6);
  cargo.update(0, { ...docked, depart: 1 });
  assert.ok(cargo.ship.position.distanceTo(dock.outbound.to) < 1e-6);
  // Docked, its nose points the dock's way.
  cargo.update(0, docked);
  const nose = new THREE.Vector3(0, 0, 1).applyQuaternion(cargo.ship.quaternion);
  assert.ok(nose.dot(dock.heading) > 0.98, `${nose.dot(dock.heading)}`);
});

test("it takes no clicks, and dispose removes it and frees everything it made", () => {
  const cargo = made();
  const parent = new THREE.Group();
  parent.add(cargo.group);
  cargo.update(1, docked);
  parent.updateMatrixWorld(true);
  const things = new Set<THREE.EventDispatcher<{ dispose: object }>>();
  cargo.group.traverse((o) => {
    const hits: THREE.Intersection[] = [];
    o.raycast(new THREE.Raycaster(), hits);
    assert.equal(hits.length, 0);
    const mesh = o as THREE.Mesh;
    if ((o as THREE.Mesh).isMesh) things.add(mesh.geometry as never);
    if (mesh.material) things.add(mesh.material as never);
  });
  const freed = new Set<unknown>();
  for (const x of things) x.addEventListener("dispose", () => freed.add(x));
  cargo.dispose();
  assert.equal(cargo.group.parent, null);
  assert.equal(freed.size, things.size);
});
