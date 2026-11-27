// Tests for the asteroid growth pieces: what each tier shows, how it's cleaned up,
// and that nothing gets between the building-view camera and the robot or screen.
// Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import { asteroidScaleAt, piecesUpTo, PIECE_IDS } from "../src/belt/growth/ladders.ts";
import { createPiece, hasPiece } from "../src/belt/growth/pieces.ts";
import { previewTier } from "../src/belt/growth/preview.ts";
import { DECK_R } from "../src/belt/growth/deck.ts";
import { DISH_SPOT, LANDMARK_SPOT } from "../src/belt/growth/jobsPieces.ts";
import { PAD_AT } from "../src/belt/growth/sharedPieces.ts";
import { DESK_SPOT, MONITOR_AT, MONITOR_TURN, workToDeck } from "../src/interior/workspace.ts";
import type { GrowthHandle } from "../src/belt/growth/applyGrowth.ts";
import { ASTEROIDS, groundOf, make, shown, stubKit, type Asteroid } from "./growthStub.ts";

const TIERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const names = (g: THREE.Object3D) => g.children.map((c) => c.name);
const stageShown = (g: GrowthHandle) => g.landmark().userData.stage;

test("every piece of both asteroid ladders has a model", () => {
  for (const id of ASTEROIDS) {
    for (const piece of piecesUpTo(id, 10)) assert.ok(hasPiece(piece), piece);
  }
});

test("a piece with no model yet says so rather than drawing nothing", () => {
  const { kit } = stubKit();
  for (const id of PIECE_IDS.filter((p) => !hasPiece(p))) {
    assert.throws(() => createPiece(id, "#ffffff", kit), new RegExp(id));
  }
});

test("a built asteroid starts at tier 0: today's landmark, its own size, no pieces", () => {
  for (const id of ASTEROIDS) {
    const a = make(id);
    assert.equal(a.growth.tier, 0);
    assert.deepEqual(names(a.growth.pieces), []);
    assert.equal(a.growth.landmark(), a.first.group);
    // Where the grown stages stand too, clear of the desk.
    const spot = id === "jobs" ? DISH_SPOT : LANDMARK_SPOT;
    assert.deepEqual(a.first.group.position.toArray(), spot.toArray());
    assert.equal(a.body.scale.x, 1);
    assert.equal(a.growth.labelHeight(), 4.6);
  }
});

test("tier 3 shows exactly its pieces and the second landmark stage", () => {
  const a = make("jobs");
  a.growth.setTier(3);
  assert.equal(a.growth.tier, 3);
  assert.deepEqual(names(a.growth.pieces), piecesUpTo("jobs", 3));
  assert.equal(stageShown(a.growth), 2);
  assert.ok(a.holder.children.includes(a.growth.landmark()));
  assert.ok(!a.holder.children.includes(a.first.group), "the old stage is gone");
});

test("going back down removes the extras and brings back the same objects later", () => {
  const a = make("jobs");
  a.growth.setTier(3);
  const dome = a.growth.pieces.getObjectByName("deckRing2");
  a.growth.setTier(1);
  assert.deepEqual(names(a.growth.pieces), piecesUpTo("jobs", 1));
  assert.equal(a.growth.landmark(), a.first.group);
  const kept = a.kept.size;
  a.growth.setTier(3);
  assert.equal(a.growth.pieces.getObjectByName("deckRing2"), dome);
  assert.equal(a.kept.size, kept, "nothing is built twice");
  a.growth.setTier(0);
  assert.deepEqual(names(a.growth.pieces), []);
  assert.equal(a.holder.children.filter((c) => c.userData.stage).length, 1);
});

test("every tier shows its ladder and its landmark stage", () => {
  for (const id of ASTEROIDS) {
    const a = make(id);
    for (const tier of TIERS) {
      a.growth.setTier(tier);
      const onDesk = a.desk.children.flatMap((c) => c.children.map((p) => p.name));
      assert.deepEqual(
        [...names(a.growth.pieces), ...onDesk].sort(),
        [...piecesUpTo(id, tier)].sort(),
        `${id} tier ${tier}`,
      );
      assert.equal(stageShown(a.growth), tier >= 10 ? 4 : tier >= 6 ? 3 : tier >= 3 ? 2 : 1);
    }
  }
});

test("the second toy rocket sits on the desk, which keeps its size", () => {
  const a = make("career");
  a.growth.setTier(10);
  const rocket = a.desk.getObjectByName("deskRocket");
  assert.ok(rocket);
  a.world.updateMatrixWorld(true);
  assert.equal(rocket.getWorldScale(new THREE.Vector3()).x.toFixed(3), "0.650");
  a.growth.setTier(0);
  assert.equal(a.desk.getObjectByName("deskRocket"), undefined);
});

test("asteroids grow gently with the tier", () => {
  for (const id of ASTEROIDS) {
    const a = make(id);
    for (const tier of TIERS) {
      a.growth.setTier(tier);
      assert.equal(a.scales.at(-1), asteroidScaleAt(tier, id));
      assert.ok(a.body.scale.x <= 1.3);
    }
  }
});

test("a tier outside 0 to 10 is held at the nearest end", () => {
  const a = make("jobs");
  a.growth.setTier(42);
  assert.equal(a.growth.tier, 10);
  a.growth.setTier(-3);
  assert.equal(a.growth.tier, 0);
});

test("Opportunity Office's dishes stand well past the deck, on booms buried in the rock", () => {
  const ground = groundOf("jobs");
  const a = make("jobs");
  const v = new THREE.Vector3();
  for (const tier of [0, ...TIERS]) {
    a.growth.setTier(tier);
    a.world.updateMatrixWorld(true);
    // In the deck's own units, whatever the asteroid has grown to.
    const local = (p: THREE.Vector3) => a.holder.worldToLocal(p);
    const booms: THREE.Object3D[] = [];
    a.growth.landmark().traverse((o) => {
      if (o.name === "dishHead") {
        const at = local(o.getWorldPosition(v));
        assert.ok(Math.hypot(at.x, at.z) > DECK_R * 2.5, `tier ${tier}: too near the desk`);
      }
      if (o.name === "boom") booms.push(o);
    });
    assert.equal(booms.length, tier >= 6 ? 3 : 1, `tier ${tier}`);
    for (const boom of booms) {
      let buried = 0;
      boom.traverse((o) => {
        const p = (o as THREE.Mesh).geometry?.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < (p?.count ?? 0); i++) {
          local(v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld));
          const inside = ground.radius(Math.atan2(v.z, v.x), v.y);
          if (v.y < -1.4 && Math.hypot(v.x, v.z) < inside) buried++;
        }
      });
      assert.ok(buried > 0, `tier ${tier}: a boom doesn't reach the rock`);
    }
  }
});

test("an unbuilt asteroid's landmark stays in the middle, for its hologram", () => {
  assert.deepEqual(make("career", false).first.group.position.toArray(), [0, 0, 0]);
});

test("an unbuilt asteroid never grows", () => {
  const a = make("career", false);
  a.growth.setTier(10);
  assert.equal(a.growth.tier, 0);
  assert.deepEqual(names(a.growth.pieces), []);
  assert.equal(a.growth.landmark(), a.first.group);
  assert.deepEqual(a.scales, []);
});

test("newPiecesFor gives what that tier added, with its landmark only if that stage is on show", () => {
  const a = make("jobs");
  const added = (tier: number) => a.growth.newPiecesFor(tier).map((g) => g.name);
  a.growth.setTier(3);
  assert.deepEqual(added(3), ["signalRings", "landmark"]);
  a.growth.setTier(10);
  assert.deepEqual(added(3), ["signalRings"], "stage 2 is no longer on the asteroid");
  assert.deepEqual(added(2), ["deckRing2"]);
  assert.deepEqual(added(6), []);
  assert.deepEqual(added(10), ["deepSpaceArray", "landmark"]);
  for (let tier = 1; tier <= 10; tier++) {
    for (const g of a.growth.newPiecesFor(tier)) assert.ok(g.parent, `tier ${tier}: ${g.name}`);
  }
  a.growth.setTier(1);
  assert.deepEqual(added(2), [], "not shown, so nothing new");
});

test("every part is clickable as its building and freed with the kit", () => {
  for (const id of ASTEROIDS) {
    const a = make(id);
    for (const tier of TIERS) {
      a.growth.setTier(tier);
      for (const root of [a.growth.pieces, a.desk, a.growth.landmark()]) {
        root.traverse((o) => {
          if (o !== a.desk) assert.equal(o.userData.buildingId, id, o.name || o.type);
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          assert.ok(a.kept.has(mesh.geometry), `${id} ${tier}: geometry not kept`);
          assert.ok(a.kept.has(mesh.material), `${id} ${tier}: material not kept`);
        });
      }
    }
  }
});

test("far away, only small details are hidden: every piece still shows", () => {
  const visibleMeshes = (g: THREE.Object3D) => {
    let n = 0;
    g.traverseVisible((o) => ((o as THREE.Mesh).isMesh ? n++ : 0));
    return n;
  };
  for (const id of ASTEROIDS) {
    const a = make(id);
    a.growth.setTier(10);
    a.growth.update(1);
    const flyer = (p: THREE.Object3D) => p.name === "shipLaunch"; // only shows in flight
    const near = a.growth.pieces.children.map(visibleMeshes);
    a.growth.setDetail("far");
    const far = a.growth.pieces.children.map(visibleMeshes);
    a.growth.pieces.children.forEach((p, i) => {
      if (!flyer(p)) assert.ok(far[i]! > 0, `${p.name} vanished far away`);
      assert.ok(far[i]! <= near[i]!, p.name);
    });
    assert.ok(far.reduce((x, y) => x + y) < near.reduce((x, y) => x + y), "something is hidden");
    a.growth.setDetail("near");
    assert.deepEqual(a.growth.pieces.children.map(visibleMeshes), near);
  }
});

test("light effects never take a click meant for what's behind them", () => {
  const effects = [
    ["jobs", "deepSpaceArray"],
    ["jobs", "signalRings"],
    ["career", "shipLaunch"],
  ] as const;
  const ray = new THREE.Raycaster();
  for (const [id, name] of effects) {
    const a = make(id);
    a.growth.setTier(10);
    a.growth.update(15); // mid-launch, so the flying ship is out
    a.world.updateMatrixWorld(true);
    const piece = a.growth.pieces.getObjectByName(name)!;
    let tried = 0;
    piece.traverse((o) => {
      const mesh = o as THREE.Mesh;
      const effect = o.userData.reaches || name === "signalRings";
      if (!mesh.isMesh || !effect) return;
      // Aim straight at one of its own triangles.
      const p = mesh.geometry.attributes.position as THREE.BufferAttribute;
      const index = mesh.geometry.index;
      const corner = (k: number) =>
        new THREE.Vector3().fromBufferAttribute(p, index ? index.getX(k) : k);
      const at = corner(0).add(corner(1)).add(corner(2)).divideScalar(3);
      at.applyMatrix4(mesh.matrixWorld);
      const from = at.clone().add(new THREE.Vector3(3, 7, 5));
      ray.set(from, at.clone().sub(from).normalize());
      assert.deepEqual(ray.intersectObject(mesh, false).length, 0, `${name} takes clicks`);
      tried++;
    });
    assert.ok(tried > 0, name);
  }
  // A solid piece is still clickable: straight down onto the landing pad.
  const a = make("jobs");
  a.growth.setTier(10);
  a.world.updateMatrixWorld(true);
  const over = PAD_AT.clone().multiplyScalar(a.body.scale.x).setY(9);
  ray.set(over, new THREE.Vector3(0, -1, 0));
  const pad = a.growth.pieces.getObjectByName("outrigger")!;
  assert.ok(ray.intersectObject(pad, true).length > 0);
});

const positionsOf = (root: THREE.Object3D) => {
  const out: number[] = [];
  root.traverse((o) => {
    const g = (o as THREE.Mesh).geometry;
    if (g) out.push(...(g.attributes.position!.array as Float32Array).slice(0, 300));
    out.push(...o.position.toArray(), o.quaternion.x, o.quaternion.y);
  });
  return out;
};

test("growth looks the same on every visit", () => {
  for (const id of ASTEROIDS) {
    const [a, b] = [make(id), make(id)];
    for (const x of [a, b]) {
      x.growth.setTier(10);
      x.growth.update(12.5);
    }
    assert.deepEqual(positionsOf(a.growth.pieces), positionsOf(b.growth.pieces));
    assert.deepEqual(positionsOf(a.growth.landmark()), positionsOf(b.growth.landmark()));
  }
});

test("behind the computer screen the pieces and a grown landmark hold still", () => {
  for (const id of ASTEROIDS) {
    const a = make(id);
    a.growth.setTier(10);
    a.growth.update(3);
    const both = () => [positionsOf(a.growth.pieces), positionsOf(a.growth.landmark())];
    const [pieces, landmark] = both();
    a.growth.update(30, { hold: true });
    assert.deepEqual(both(), [pieces, landmark], id);
    a.growth.update(30);
    assert.notDeepEqual(both()[0], pieces, id);
    assert.notDeepEqual(both()[1], landmark, id);
  }
});

test("a grown landmark slows for reduced motion, like the pieces", () => {
  const [slow, plain] = [make("career"), make("career")];
  for (const x of [slow, plain]) x.growth.setTier(10);
  slow.growth.update(40, { motion: 0.3 });
  plain.growth.update(12);
  assert.deepEqual(positionsOf(slow.growth.landmark()), positionsOf(plain.growth.landmark()));
});

test("today's landmark keeps moving as it always has", () => {
  const a = make("jobs");
  a.growth.update(3);
  const before = positionsOf(a.growth.landmark());
  a.growth.update(8, { hold: true, motion: 0.3 });
  assert.notDeepEqual(positionsOf(a.growth.landmark()), before);
});

test("the station beam points at the station even when it first shows during a hold", () => {
  const a = make("jobs");
  a.world.position.set(30, 0, 22); // out on the ring; the station is at the middle
  a.world.updateMatrixWorld(true);
  a.growth.setTier(10);
  const aim = () => {
    a.world.updateMatrixWorld(true);
    const array = a.growth.pieces.getObjectByName("deepSpaceArray")!;
    const beam = array.children.find((c) => c.userData.reaches)!;
    const from = beam.getWorldPosition(new THREE.Vector3());
    const along = new THREE.Vector3(0, 1, 0).applyQuaternion(
      beam.getWorldQuaternion(new THREE.Quaternion()),
    );
    return along.dot(from.negate().setY(0).normalize());
  };
  assert.ok(aim() > 0.999, `as shown: ${aim()}`);
  // The asteroid keeps turning behind the screen; the beam keeps pointing home.
  a.world.rotation.y = 1.9;
  a.growth.update(5, { hold: true });
  assert.ok(aim() > 0.999, `held: ${aim()}`);
});

/** What the building view must always see: the screen, the robot and the desk top. */
function sightTargets(): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const turn = new THREE.Quaternion().setFromEuler(MONITOR_TURN);
  for (const x of [-0.64, -0.32, 0, 0.32, 0.64]) {
    for (const y of [-0.4, 0, 0.4]) {
      out.push(workToDeck(new THREE.Vector3(x, y, 0).applyQuaternion(turn).add(MONITOR_AT)));
    }
  }
  for (const x of [-0.3, 0, 0.3]) {
    for (const y of [0.45, 0.8, 1.1, 1.4]) out.push(workToDeck(new THREE.Vector3(x, y, 0)));
  }
  for (const x of [-0.85, 0, 0.85]) {
    for (const z of [0.46, 1.1]) out.push(workToDeck(new THREE.Vector3(x, 0.76, z)));
  }
  return out;
}

/** Times to check moving pieces at: a few minutes of orbits, sweeps and launches. */
const TIMES = Array.from({ length: 300 }, (_, i) => i * 0.73);

test("nothing ever comes between the building camera and the robot or screen", () => {
  const ray = new THREE.Raycaster();
  const targets = sightTargets();
  const camera = DESK_SPOT.camera;
  for (const id of ASTEROIDS) {
    const a = make(id);
    for (const tier of [0, ...TIERS]) {
      a.growth.setTier(tier);
      const roots = [a.growth.pieces, a.growth.landmark()];
      const times = tier === 10 || tier === 3 || tier === 6 ? TIMES : TIMES.slice(0, 40);
      for (const t of times) {
        a.growth.update(t);
        a.world.updateMatrixWorld(true);
        for (const to of targets) {
          const dir = to.clone().sub(camera);
          ray.set(camera, dir.clone().normalize());
          ray.far = dir.length() - 0.02;
          const hit = ray.intersectObjects(roots, true).find((h) => shown(h.object));
          assert.ok(!hit, `${id} tier ${tier} t=${t}: ${hit && path(hit.object)}`);
        }
      }
    }
  }
});

const path = (o: THREE.Object3D): string =>
  o.parent?.parent ? `${path(o.parent)}/${o.name || o.type}` : o.name || o.type;

function eachVertex(root: THREE.Object3D, see: (v: THREE.Vector3, o: THREE.Object3D) => void) {
  const v = new THREE.Vector3();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !shown(o) || o.userData.reaches) return;
    const p = mesh.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++)
      see(v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld), o);
  });
}

test("growth stays off the desk, away from the camera and clear of the neighbours", () => {
  for (const id of ASTEROIDS) {
    const a = make(id);
    for (const tier of [0, ...TIERS]) {
      a.growth.setTier(tier);
      let widest = 0;
      let closest = Infinity;
      let onDesk = "";
      for (const t of TIMES.slice(0, 60)) {
        a.growth.update(t);
        a.world.updateMatrixWorld(true);
        const roots = [a.growth.pieces, a.growth.landmark()];
        for (const root of roots) {
          eachVertex(root, (v, o) => {
            widest = Math.max(widest, Math.hypot(v.x, v.z));
            closest = Math.min(closest, v.distanceTo(DESK_SPOT.camera));
            if (v.x > -0.4 && v.x < 1.0 && v.z > -0.6 && v.z < 0.75 && v.y > 0.12 && v.y < 1.4) {
              onDesk = path(o);
            }
          });
        }
      }
      // Neighbours' centres are about 32.7 apart and the station's truss ends 21 away.
      assert.ok(widest <= 14, `${id} tier ${tier} reaches ${widest.toFixed(1)}`);
      assert.ok(closest > 0.9, `${id} tier ${tier} comes ${closest.toFixed(2)} from the camera`);
      assert.equal(onDesk, "", `${id} tier ${tier}`);
    }
  }
});

test("the label rises above a grown landmark", () => {
  for (const id of ASTEROIDS) {
    const a = make(id);
    a.growth.setTier(10);
    a.world.updateMatrixWorld(true);
    const top = new THREE.Box3().setFromObject(a.growth.landmark()).max.y;
    assert.ok(a.growth.labelHeight() > top, id);
  }
});

test("the preview address picks a tier from 0 to 10, or nothing", () => {
  assert.equal(previewTier("?growthPreview=3"), 3);
  assert.equal(previewTier("?growthPreview=0"), 0);
  assert.equal(previewTier("?growthPreview=99"), 10);
  assert.equal(previewTier(""), null);
  assert.equal(previewTier("?growthPreview="), null);
  assert.equal(previewTier("?growthPreview=abc"), null);
});
