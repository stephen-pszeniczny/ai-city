// Tests for keeping the built scene between opens (src/belt/space/stored.ts). Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import {
  arraysToGeometry,
  fingerprint,
  geometryToArrays,
  rememberRock,
  storedRock,
} from "../src/belt/space/stored.ts";

test("a fingerprint is stable for the same code and changes when the code changes", () => {
  const a = () => 1 + 1;
  const b = () => 1 + 2;
  assert.equal(fingerprint(a), fingerprint(a));
  assert.notEqual(fingerprint(a), fingerprint(b));
  assert.match(fingerprint(a), /^[0-9a-f]{8}$/);
});

test("a geometry survives being stored and loaded", () => {
  const geo = new THREE.IcosahedronGeometry(1, 2);
  geo.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(
      new Float32Array(geo.attributes.position!.count * 3).fill(0.5),
      3,
    ),
  );
  const back = arraysToGeometry(geometryToArrays(geo));
  for (const name of ["position", "normal", "color"]) {
    assert.deepEqual(
      Array.from(back.getAttribute(name).array),
      Array.from(geo.getAttribute(name).array),
      name,
    );
  }
});

test("a stored rock is found again by its seed, tint and detail", () => {
  const fake = new THREE.BufferGeometry();
  fake.setAttribute("position", new THREE.Float32BufferAttribute([9, 9, 9, 8, 8, 8, 7, 7, 7], 3));
  fake.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  fake.setAttribute("color", new THREE.Float32BufferAttribute([1, 0, 0, 1, 0, 0, 1, 0, 0], 3));
  rememberRock(4.2, "#123456", 3, geometryToArrays(fake));
  const geo = storedRock(4.2, "#123456", 3);
  assert.ok(geo);
  assert.deepEqual(Array.from(geo.getAttribute("position").array), [9, 9, 9, 8, 8, 8, 7, 7, 7]);
  assert.equal(storedRock(4.2, "#123456", 4), undefined, "a different detail is a different rock");
});
