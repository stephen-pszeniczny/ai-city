// The shape of a large asteroid: smooth, lumpy rock with a flattened top (where
// the building sits), tinted with its building's colour.
import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

import { fbm, perlin } from "./noise";

export function rockGeometry(seed: number, tint: string): THREE.BufferGeometry {
  let geo: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, 5);
  geo.deleteAttribute("normal");
  geo.deleteAttribute("uv");
  geo = mergeVertices(geo); // shared vertices give smooth rock instead of facets
  const p = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(p.count * 3);
  const tc = new THREE.Color(tint);
  const base = new THREE.Color(0x4a4541);
  const v = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const n = fbm(v.x * 1.4 + seed, v.y * 1.4, v.z * 1.4 - seed, 5);
    const ridge = 1 - Math.abs(perlin.noise(v.x * 3.2 + seed, v.y * 3.2, v.z * 3.2));
    const r = 1 + n * 0.42 + ridge * 0.08 + fbm(v.x * 7, v.y * 7 + seed, v.z * 7, 3) * 0.06;
    v.multiplyScalar(r);
    v.x *= 1.25;
    v.y *= 0.78;
    v.z *= 1.08;
    if (v.y > 0.38) v.y = 0.38 + (v.y - 0.38) * 0.12; // flat top for the deck
    p.setXYZ(i, v.x, v.y, v.z);
    const shade = 0.55 + 0.9 * (0.5 + fbm(v.x * 5 + 3, v.y * 5, v.z * 5, 3));
    c.copy(base)
      .lerp(tc, 0.26 + 0.14 * (n + 0.5))
      .multiplyScalar(shade * (v.y > 0.36 ? 1.1 : 1));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}
