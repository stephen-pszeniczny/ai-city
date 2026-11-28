// Tests for telling which new pieces the building view can't show. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import { SEEN_SHARE, shareInView } from "../src/belt/levelUpView.ts";
import { DECK_R } from "../src/belt/growth/deck.ts";
import { DESK_SPOT } from "../src/interior/workspace.ts";

const camera = new THREE.PerspectiveCamera(55, 1.6, 0.5, 1000);
camera.position.copy(DESK_SPOT.camera);
camera.lookAt(DESK_SPOT.screen);

const cube = (at: THREE.Vector3) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4));
  mesh.position.copy(at);
  const group = new THREE.Group();
  group.add(mesh);
  return group;
};

test("in front of the camera is seen; behind it isn't", () => {
  assert.equal(shareInView([cube(DESK_SPOT.screen)], camera), 1);
  const behind = DESK_SPOT.camera.clone().multiplyScalar(2).sub(DESK_SPOT.screen);
  assert.equal(shareInView([cube(behind)], camera), 0);
  assert.equal(shareInView([], camera), 0);
});

test("under the deck is hidden by it", () => {
  const deck = { frame: new THREE.Group(), radius: DECK_R };
  const under = cube(new THREE.Vector3(0, -0.8, 0.6));
  assert.ok(shareInView([under], camera) > SEEN_SHARE, "in the frame");
  assert.ok(shareInView([under], camera, deck) < SEEN_SHARE, "but hidden");
});
