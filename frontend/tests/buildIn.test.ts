// Tests for how new upgrade pieces build themselves in. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import { createBuildIn } from "../src/belt/growth/buildIn.ts";
import { make as makeAsteroid } from "./growthStub.ts";

/** Opportunity Office, whose tier 3 grows the dish (and so moves its label). */
const make3 = () => makeAsteroid("jobs");

/** A piece standing off-centre on a mount, with its own base scale. */
function piece() {
  const root = new THREE.Group();
  const mount = new THREE.Group();
  mount.position.set(1, 2, 3);
  mount.rotation.y = 0.7;
  root.add(mount);
  const group = new THREE.Group();
  group.position.set(2, 0, 1);
  group.scale.setScalar(0.5);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 2), new THREE.MeshBasicMaterial());
  mesh.position.set(3, 4, 0);
  group.add(mesh);
  mount.add(group);
  root.updateMatrixWorld(true);
  return { root, mount, group };
}

const boxOf = (o: THREE.Object3D) => {
  o.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(o);
};
const make = (groups: THREE.Group[], root: THREE.Group, o = {}) =>
  createBuildIn(groups, root, "#41c9d6", { texture: new THREE.Texture(), ...o });

test("a new piece grows from the foot of where it stands to exactly its own size", () => {
  const { root, mount, group } = piece();
  const full = boxOf(group);
  const foot = full.getCenter(new THREE.Vector3()).setY(full.min.y);
  const effect = make([group], root);

  effect.apply(0);
  const small = boxOf(group);
  assert.ok(small.getSize(new THREE.Vector3()).length() < 0.05, "starts as nothing");
  assert.ok(small.getCenter(new THREE.Vector3()).distanceTo(foot) < 0.1, "at its own foot");
  effect.restore();

  effect.apply(1);
  assert.ok(boxOf(group).min.distanceTo(full.min) < 1e-6);
  assert.ok(boxOf(group).max.distanceTo(full.max) < 1e-6);
  effect.restore();
  assert.deepEqual(group.position.toArray(), [2, 0, 1]);
  assert.deepEqual(group.scale.toArray(), [0.5, 0.5, 0.5]);
  assert.equal(mount.children.length, 1, "nothing was added to the growth system's group");
});

test("a piece that moves itself keeps moving, without piling up", () => {
  const { root, group } = piece();
  const effect = make([group], root);
  for (let i = 0; i < 20; i++) {
    effect.restore();
    group.position.set(2 + i * 0.1, 0, 1); // its own update
    effect.apply(0.5);
  }
  effect.restore();
  assert.ok(Math.abs(group.position.x - 3.9) < 1e-9, `${group.position.x}`);
  assert.deepEqual(group.scale.toArray(), [0.5, 0.5, 0.5]);
});

test("restore without apply changes nothing", () => {
  const { root, group } = piece();
  const effect = make([group], root);
  group.position.x = 9;
  effect.restore();
  assert.equal(group.position.x, 9);
});

const opacities = (o: THREE.Object3D) => {
  const out: number[] = [];
  o.traverse((c) => {
    const m = (c as THREE.Mesh).material as THREE.Material | undefined;
    if (m) out.push(m.opacity);
  });
  return out;
};

test("the tint glow follows the glow setting, and fades out at both ends", () => {
  const { root, group } = piece();
  const full = make([group], root);
  full.apply(0.5);
  const bright = opacities(full.overlay);
  assert.ok(bright.length > 0 && bright.every((v) => v > 0.1), `${bright}`);
  full.restore();
  full.apply(1);
  assert.ok(opacities(full.overlay).every((v) => v < 0.01));
  full.restore();
  const dim = make([group], root, { glow: 0 });
  dim.apply(0.5);
  assert.ok(opacities(dim.overlay).every((v) => v === 0));
});

test("the movement setting turns off the bounce and the rising sparks", () => {
  const { root, group } = piece();
  const largest = (motion: number) => {
    const effect = make([group], root, { motion });
    let most = 0;
    for (let k = 0; k <= 1; k += 0.01) {
      effect.apply(k);
      most = Math.max(most, group.scale.x);
      effect.restore();
    }
    effect.dispose();
    return most;
  };
  assert.ok(largest(1) > 0.52, "a small bounce");
  assert.ok(largest(0) <= 0.5 + 1e-9, "no bounce");
});

test("the glow takes no clicks, and dispose removes it and frees what it made", () => {
  const { root, group } = piece();
  const effect = make([group], root);
  assert.equal(effect.overlay.parent, root);
  const freed = new Set<unknown>();
  const made = new Set<THREE.EventDispatcher<{ dispose: object }>>();
  effect.overlay.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.material) made.add(mesh.material as never);
    if ((o as THREE.Points).isPoints) made.add(mesh.geometry as never);
    const hits: THREE.Intersection[] = [];
    o.raycast(new THREE.Raycaster(), hits);
    assert.equal(hits.length, 0);
  });
  for (const m of made) m.addEventListener("dispose", () => freed.add(m));
  effect.dispose();
  assert.equal(effect.overlay.parent, null);
  assert.equal(freed.size, made.size);
});

const parts = (o: THREE.Object3D) => ({
  halos: o.children.filter((c) => (c as THREE.Sprite).isSprite),
  sparks: o.children.filter((c) => (c as THREE.Points).isPoints) as THREE.Points[],
});

test("a wide piece gets no halo (it would cut through the deck), only sparks along it", () => {
  const root = new THREE.Group();
  const ring = new THREE.Group();
  ring.add(new THREE.Mesh(new THREE.TorusGeometry(5, 0.1, 8, 64), new THREE.MeshBasicMaterial()));
  root.add(ring);
  const effect = make([ring], root);
  const { halos, sparks } = parts(effect.overlay);
  assert.equal(halos.length, 0);
  assert.equal(sparks.length, 1);
  const p = sparks[0]!.geometry.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const radius = Math.hypot(p.getX(i), p.getY(i));
    assert.ok(radius > 4.8 && radius < 5.2, `a spark off the piece at radius ${radius}`);
  }
});

test("a small piece gets a halo that nothing cuts", () => {
  const { root, group } = piece();
  group.children[0]!.scale.setScalar(0.4);
  group.children[0]!.position.set(0, 0, 0);
  const { halos } = parts(make([group], root).overlay);
  assert.equal(halos.length, 1);
  assert.equal(((halos[0] as THREE.Sprite).material as THREE.SpriteMaterial).depthTest, false);
});

// Why the scene ends a build-in before it puts the tier on again (a skip or leave
// arrives between frames, with the pieces still small).
test("a tier measured mid-build is wrong; ending the build-in first gets it right", () => {
  const { growth, world } = make3();
  growth.setTier(3);
  const full = growth.labelHeight();
  const effect = createBuildIn(growth.newPiecesFor(3), world, "#41c9d6", {
    texture: new THREE.Texture(),
  });
  effect.apply(0);
  growth.setTier(3);
  assert.ok(full > 5, `the grown dish lifts the label: ${full}`);
  assert.equal(growth.labelHeight(), 4.6, "measured from the shrunken dish, it stays down");
  effect.dispose();
  growth.setTier(3);
  assert.ok(Math.abs(growth.labelHeight() - full) < 1e-6);
});
