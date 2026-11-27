// Tests for the asteroid growth pieces: what each tier shows, how it's cleaned up,
// and that nothing gets between the building-view camera and the robot or screen.
// Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import { createGrowth, type GrowthHandle } from "../src/belt/growth/applyGrowth.ts";
import { DECK_Y, ROCK_SCALE } from "../src/belt/growth/deck.ts";
import { rockGround } from "../src/belt/growth/ground.ts";
import { asteroidScaleAt, piecesUpTo, PIECE_IDS } from "../src/belt/growth/ladders.ts";
import { createPiece, hasPiece } from "../src/belt/growth/pieces.ts";
import { previewTier } from "../src/belt/growth/preview.ts";
import { PAD_AT } from "../src/belt/growth/sharedPieces.ts";
import { createLandmark } from "../src/belt/landmarks.ts";
import type { Kit } from "../src/belt/materials.ts";
import { rockGeometry } from "../src/belt/space/rock.ts";
import { DESK_SPOT, MONITOR_AT, MONITOR_TURN, workToDeck } from "../src/interior/workspace.ts";

const TIERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
type Asteroid = "jobs" | "career";
const ASTEROIDS: Asteroid[] = ["jobs", "career"];
/** Each one's tint and rock, as in space/orbit.ts and asteroids.ts. */
const LOOKS = {
  jobs: { tint: "#41c9d6", seed: 1.3 },
  career: { tint: "#9b7bff", seed: 5 * 3.7 + 1.3 },
} as const;

/** The design kit without a browser: plain materials, and a note of what it must free. */
function stubKit() {
  const kept = new Set<unknown>();
  const keep = <T>(x: T): T => {
    kept.add(x);
    return x;
  };
  const std = () => keep(new THREE.MeshStandardMaterial());
  const mats = {
    hull: std(),
    gold: std(),
    darkMetal: std(),
    steel: std(),
    solar: std(),
    radiator: std(),
    window: std(),
  };
  const glows = new Map<string, THREE.MeshBasicMaterial>();
  const kit = {
    mats,
    keep,
    glow(hex: THREE.ColorRepresentation, k: number) {
      const key = `${new THREE.Color(hex).getHexString()}:${k}`;
      let m = glows.get(key);
      if (!m) glows.set(key, (m = keep(new THREE.MeshBasicMaterial())));
      return m;
    },
    addBlinker() {},
    setStationLights() {},
    updateBlinkers() {},
    dispose() {},
  } as unknown as Kit;
  return { kit, kept };
}

const grounds = new Map<Asteroid, ReturnType<typeof rockGround>>();
function groundOf(id: Asteroid) {
  let g = grounds.get(id);
  if (!g) {
    g = rockGround(rockGeometry(LOOKS[id].seed, LOOKS[id].tint), ROCK_SCALE, DECK_Y);
    grounds.set(id, g);
  }
  return g;
}

/** An asteroid's growth on its own: the same groups asteroids.ts hands over. */
function make(id: Asteroid, built = true) {
  const { kit, kept } = stubKit();
  const world = new THREE.Group(); // where the asteroid is
  const body = new THREE.Group(); // what grows (rock, deck, holder)
  const holder = new THREE.Group();
  const desk = new THREE.Group(); // keeps its size
  world.add(body, desk);
  body.add(holder);
  const first = createLandmark(id, LOOKS[id].tint, kit);
  holder.add(first.group);
  const scales: number[] = [];
  const growth = createGrowth({
    id,
    tint: LOOKS[id].tint,
    kit,
    built,
    holder,
    desk,
    landmark: first,
    ground: groundOf(id),
    onScale: (s) => {
      scales.push(s);
      body.scale.setScalar(s);
    },
  });
  return { growth, kit, kept, world, body, holder, desk, first, scales };
}

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
    assert.deepEqual(a.first.group.position.toArray(), [0, 0, 0]);
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

test("an unbuilt asteroid never grows", () => {
  const a = make("career", false);
  a.growth.setTier(10);
  assert.equal(a.growth.tier, 0);
  assert.deepEqual(names(a.growth.pieces), []);
  assert.equal(a.growth.landmark(), a.first.group);
  assert.deepEqual(a.scales, []);
});

test("newPiecesFor gives what that tier added, including a grown landmark", () => {
  const a = make("jobs");
  a.growth.setTier(10);
  assert.deepEqual(
    a.growth.newPiecesFor(3).map((g) => g.name),
    ["signalRings", "landmark"],
  );
  assert.deepEqual(
    a.growth.newPiecesFor(2).map((g) => g.name),
    ["deckRing2"],
  );
  assert.deepEqual(
    a.growth.newPiecesFor(6).map((g) => g.name),
    ["landmark"],
  );
  a.growth.setTier(1);
  assert.deepEqual(a.growth.newPiecesFor(2), [], "not shown, so nothing new");
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

test("behind the computer screen the pieces hold still", () => {
  const a = make("jobs");
  a.growth.setTier(10);
  a.growth.update(3);
  const before = positionsOf(a.growth.pieces);
  a.growth.update(30, { hold: true });
  assert.deepEqual(positionsOf(a.growth.pieces), before);
  a.growth.update(30);
  assert.notDeepEqual(positionsOf(a.growth.pieces), before);
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

test("nothing grown ever comes between the building camera and the robot or screen", () => {
  const ray = new THREE.Raycaster();
  const targets = sightTargets();
  const camera = DESK_SPOT.camera;
  for (const id of ASTEROIDS) {
    const a = make(id);
    for (const tier of TIERS) {
      a.growth.setTier(tier);
      // Stage 1 is today's landmark at the deck's centre: unchanged, and not judged here.
      const roots = [a.growth.pieces, ...(tier >= 3 ? [a.growth.landmark()] : [])];
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

const shown = (o: THREE.Object3D): boolean => o.visible && (!o.parent || shown(o.parent));
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
    for (const tier of TIERS) {
      a.growth.setTier(tier);
      let widest = 0;
      let closest = Infinity;
      let onDesk = "";
      for (const t of TIMES.slice(0, 60)) {
        a.growth.update(t);
        a.world.updateMatrixWorld(true);
        const roots = [a.growth.pieces, ...(tier >= 3 ? [a.growth.landmark()] : [])];
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
