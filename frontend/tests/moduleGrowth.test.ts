// Tests for the station modules' growth: what each tier shows outside and in the
// control rooms, how it's tagged, held and freed, and the tiers the scene is given.
// Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import type { XpView } from "../src/api.ts";
import { LADDERS, piecesUpTo, type PieceId } from "../src/belt/growth/ladders.ts";
import { hasPiece } from "../src/belt/growth/pieces.ts";
import { sceneTier } from "../src/belt/growth/tiers.ts";
import { makeRoom, makeStation, MODULES, type Module } from "./moduleStub.ts";

const TIERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const names = (g: THREE.Object3D) => g.children.map((c) => c.name);
const inside = (id: Module, tier: number): PieceId[] =>
  LADDERS[id].filter((s) => s.interior && s.tier <= tier).flatMap((s) => s.pieces);
const outside = (id: Module, tier: number): PieceId[] =>
  piecesUpTo(id, tier).filter((p) => !inside(id, tier).includes(p));
/** Everything the room shows: on the room's walls and floor, and on the vault door. */
const roomNames = (r: ReturnType<typeof makeRoom>) => [
  ...names(r.interior.pieces),
  ...names(r.interior.door),
];

test("every piece of both module ladders has a model", () => {
  for (const id of MODULES) {
    for (const piece of piecesUpTo(id, 10)) assert.ok(hasPiece(piece), piece);
  }
});

test("each module hands out its own group, where its pieces go", () => {
  const { station, growth } = makeStation();
  for (const id of MODULES) {
    assert.equal(growth[id].pieces.parent, station.moduleAnchors[id]);
    assert.ok(station.pickables.includes(station.moduleAnchors[id]));
  }
  assert.ok(station.moduleAnchors.planner.position.x < 0);
});

test("a module at tier 6 shows its outside pieces and none of the inside ones", () => {
  const { growth } = makeStation();
  for (const id of MODULES) {
    growth[id].setTier(6);
    assert.equal(growth[id].tier, 6);
    assert.deepEqual(names(growth[id].pieces), outside(id, 6));
  }
});

test("the inside pieces appear only in the control rooms", () => {
  for (const id of MODULES) {
    const r = makeRoom(id);
    for (const tier of [0, ...TIERS]) {
      r.interior.setTier(tier);
      assert.deepEqual(roomNames(r).sort(), inside(id, tier).sort(), `${id} ${tier}`);
    }
  }
});

test("every tier shows exactly its ladder, outside plus inside", () => {
  const { growth } = makeStation();
  for (const id of MODULES) {
    const r = makeRoom(id);
    for (const tier of TIERS) {
      growth[id].setTier(tier);
      r.interior.setTier(tier);
      assert.deepEqual(
        [...names(growth[id].pieces), ...roomNames(r)].sort(),
        [...piecesUpTo(id, tier)].sort(),
        `${id} tier ${tier}`,
      );
    }
  }
});

test("the gold finish goes on the vault door itself, so it swings with it", () => {
  const r = makeRoom("finance");
  r.interior.setTier(9);
  assert.deepEqual(names(r.interior.door), ["goldVaultDoor"]);
});

test("newPiecesFor gives what that tier added, outside or inside", () => {
  const { growth } = makeStation();
  for (const id of MODULES) {
    const r = makeRoom(id);
    growth[id].setTier(10);
    r.interior.setTier(10);
    for (const step of LADDERS[id]) {
      const out = growth[id].newPiecesFor(step.tier);
      const room = r.interior.newPiecesFor(step.tier);
      const expected = step.interior ? room : out;
      assert.deepEqual((step.interior ? out : room).length, 0, `${id} ${step.tier}`);
      assert.deepEqual(
        expected.map((g) => g.name),
        step.pieces,
        `${id} ${step.tier}`,
      );
      for (const g of expected) assert.ok(g.parent, g.name);
    }
    growth[id].setTier(1);
    r.interior.setTier(1);
    assert.equal(growth[id].newPiecesFor(2).length, 0, "not shown, so nothing new");
    assert.equal(r.interior.newPiecesFor(5).length, 0);
  }
});

test("going down and back up reuses what was built, and tiers are held to 0..10", () => {
  const { growth, kept } = makeStation();
  growth.planner.setTier(10);
  const dish = growth.planner.pieces.getObjectByName("roofDish");
  const size = kept.size;
  growth.planner.setTier(0);
  assert.deepEqual(names(growth.planner.pieces), []);
  growth.planner.setTier(42);
  assert.equal(growth.planner.tier, 10);
  assert.equal(growth.planner.pieces.getObjectByName("roofDish"), dish);
  assert.equal(kept.size, size);
  growth.planner.setTier(-1);
  assert.equal(growth.planner.tier, 0);
});

test("every part is tagged with its building and freed with the kit", () => {
  const station = makeStation();
  for (const id of MODULES) {
    const r = makeRoom(id);
    station.growth[id].setTier(10);
    r.interior.setTier(10);
    for (const [root, kept] of [
      [station.growth[id].pieces, station.kept],
      [r.interior.pieces, r.kept],
      [r.interior.door, r.kept],
    ] as const) {
      root.traverse((o) => {
        assert.equal(o.userData.buildingId, id, o.name || o.type);
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        assert.ok(kept.has(mesh.geometry), `${id}: geometry not kept (${o.parent?.name})`);
        assert.ok(kept.has(mesh.material), `${id}: material not kept (${o.parent?.name})`);
      });
    }
  }
});

test("light effects take no clicks", () => {
  const { station, growth } = makeStation();
  for (const id of MODULES) growth[id].setTier(10);
  station.group.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  let tried = 0;
  for (const id of MODULES) {
    growth[id].pieces.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      if ((mesh.material as THREE.Material).blending !== THREE.AdditiveBlending) return;
      const p = mesh.geometry.attributes.position as THREE.BufferAttribute;
      const index = mesh.geometry.index;
      const corner = (k: number) =>
        new THREE.Vector3().fromBufferAttribute(p, index ? index.getX(k) : k);
      const at = corner(0).add(corner(1)).add(corner(2)).divideScalar(3);
      at.applyMatrix4(mesh.matrixWorld);
      const from = at.clone().add(new THREE.Vector3(3, 7, 5));
      ray.set(from, at.clone().sub(from).normalize());
      assert.equal(ray.intersectObject(mesh, false).length, 0, `${o.parent?.name} takes clicks`);
      tried++;
    });
  }
  assert.ok(tried > 0);
});

const stateOf = (root: THREE.Object3D) => {
  const out: number[] = [];
  root.traverse((o) => {
    out.push(...o.position.toArray(), ...o.quaternion.toArray(), ...o.scale.toArray());
    const g = (o as THREE.Mesh).geometry;
    if (g) out.push(...(g.attributes.position!.array as Float32Array).slice(0, 60));
  });
  return out;
};

/** Both modules and both rooms at tier 10, as [name, root, update]. */
function everything() {
  const { growth } = makeStation();
  return MODULES.flatMap((id) => {
    const r = makeRoom(id);
    growth[id].setTier(10);
    r.interior.setTier(10);
    return [
      [`${id} outside`, growth[id].pieces, growth[id]],
      [`${id} inside`, r.interior.pieces, r.interior],
    ] as const;
  });
}

test("growth looks the same on every visit", () => {
  const [one, two] = [everything(), everything()];
  one.forEach(([name, root, handle], i) => {
    handle.update(12.5);
    two[i]![2].update(12.5);
    assert.deepEqual(stateOf(root), stateOf(two[i]![1]), name);
  });
});

test("behind the computer screen the pieces hold still; reduced motion slows them", () => {
  for (const [name, root, handle] of everything()) {
    handle.update(3);
    const before = stateOf(root);
    handle.update(31, { hold: true });
    assert.deepEqual(stateOf(root), before, name);
    handle.update(31);
    assert.notDeepEqual(stateOf(root), before, name);
    handle.update(10, { motion: 0.3 });
    assert.deepEqual(stateOf(root), before, `${name} slowed`);
  }
});

test("a tier that arrives during a hold still applies", () => {
  const { growth } = makeStation();
  const r = makeRoom("finance");
  growth.finance.update(4);
  growth.finance.update(9, { hold: true });
  growth.finance.setTier(8);
  r.interior.setTier(9);
  growth.finance.update(20, { hold: true });
  assert.deepEqual(names(growth.finance.pieces), outside("finance", 8));
  assert.deepEqual(roomNames(r).sort(), inside("finance", 9).sort());
});

test("each label rises above what its module has grown, and comes back down", () => {
  const { station, growth } = makeStation();
  for (const id of MODULES) {
    const base = station.anchors[id].y;
    assert.equal(growth[id].labelHeight(), base);
    growth[id].setTier(10);
    station.group.updateMatrixWorld(true);
    const still = growth[id].pieces.children.filter(
      (c) => c.name !== "satellite" && c.name !== "securityDrones",
    );
    const top = Math.max(...still.map((c) => new THREE.Box3().setFromObject(c).max.y));
    assert.ok(growth[id].labelHeight() > Math.min(top, base), id);
    assert.ok(growth[id].labelHeight() > base && growth[id].labelHeight() < 10, id);
    growth[id].setTier(0);
    assert.equal(growth[id].labelHeight(), base);
  }
});

const building = (id: string, earning: boolean, celebrated: number, tier = celebrated) => ({
  id,
  earning,
  celebrated_tier: celebrated,
  tier,
});

test("the scene shows each earning building's celebrated tier, not the one waiting", () => {
  const xp = {
    buildings: [
      building("planner", true, 3, 5),
      building("finance", true, 0),
      building("jobs", true, 10),
      building("career", false, 4),
    ],
  } as unknown as XpView;
  assert.equal(sceneTier(xp, null, "planner"), 3);
  assert.equal(sceneTier(xp, null, "finance"), 0);
  assert.equal(sceneTier(xp, null, "jobs"), 10);
  assert.equal(sceneTier(xp, null, "career"), 0, "not earning");
  assert.equal(sceneTier(xp, null, "mail"), 0, "not listed");
});

test("with no XP everything is at tier 0, and the preview overrides it all", () => {
  assert.equal(sceneTier(undefined, null, "planner"), 0);
  assert.equal(sceneTier(undefined, 7, "planner"), 7);
  const xp = { buildings: [building("jobs", true, 2)] } as unknown as XpView;
  assert.equal(sceneTier(xp, 0, "jobs"), 0);
});
