// The shape of a large asteroid: lumpy rock with craters (dark bowls with
// raised, lighter rims), ridges and fine surface grit, and a flattened top
// where the building's deck sits. Tinted with its building's colour.
import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

import { fbm, perlin } from "./noise";
import { fingerprint, geometryToArrays, rememberRock, setVersions, storedRock } from "./stored";
import { mulberry32 } from "../../interior/robotBrain";

/** Where the flat top starts (rock units, before scaling). */
const FLAT_Y = 0.38;

type Crater = { dir: THREE.Vector3; r: number; depth: number; reach: number };

function makeCraters(seed: number, count: number): Crater[] {
  const rng = mulberry32(Math.floor(seed * 1000) + 7);
  const out: Crater[] = [];
  while (out.length < count) {
    const dir = new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1);
    if (dir.lengthSq() > 1 || dir.lengthSq() < 0.01) continue;
    dir.normalize();
    if (dir.y > 0.45) continue; // not on the flat top (the deck covers it)
    const big = rng() < 0.2;
    const r = big ? 0.22 + rng() * 0.18 : 0.05 + rng() * 0.1;
    // reach: cosine of the widest angle the crater affects (a quick test before acos).
    out.push({ dir, r, depth: big ? 0.07 : 0.035, reach: Math.cos(r * 1.6) });
  }
  return out;
}

const rockCache = new Map<string, THREE.BufferGeometry>();

/**
 * Rock geometry: positions, normals and per-vertex colours (no UVs). `detail`
 * is the sphere's subdivision (faces = 20 × (detail + 1)²). Cached per session
 * (building one takes a moment); callers get their own copy, so disposing it
 * never breaks the cache.
 */
export function rockGeometry(seed: number, tint: string, detail = 38): THREE.BufferGeometry {
  const key = `${seed}:${tint}:${detail}`;
  let geo = rockCache.get(key);
  if (!geo) {
    // Kept from a previous open if possible (see stored.ts); otherwise built and kept.
    geo = storedRock(seed, tint, detail);
    if (!geo) {
      geo = buildRock(seed, tint, detail);
      rememberRock(seed, tint, detail, geometryToArrays(geo));
    }
    rockCache.set(key, geo);
  }
  return geo.clone();
}

function buildRock(seed: number, tint: string, detail: number): THREE.BufferGeometry {
  let geo: THREE.BufferGeometry = new THREE.IcosahedronGeometry(1, detail);
  geo.deleteAttribute("normal");
  geo.deleteAttribute("uv");
  geo = mergeVertices(geo); // shared vertices give smooth rock instead of facets
  const p = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(p.count * 3);
  const tc = new THREE.Color(tint);
  const base = new THREE.Color(0x4a4541);
  const dust = new THREE.Color(0x8a8178);
  const craters = makeCraters(seed, 34);
  const v = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const n = fbm(v.x * 1.4 + seed, v.y * 1.4, v.z * 1.4 - seed, 4);
    const ridge = 1 - Math.abs(perlin.noise(v.x * 3.2 + seed, v.y * 3.2, v.z * 3.2));
    const grit = fbm(v.x * 9, v.y * 9 + seed, v.z * 9, 2);
    // Craters: a bowl inside, a raised rim just outside.
    let crater = 0;
    let rim = 0;
    for (const k of craters) {
      const dot = v.dot(k.dir);
      if (dot < k.reach) continue;
      const d = Math.acos(Math.min(1, dot));
      const x = d / k.r;
      if (x < 1) crater = Math.min(crater, -k.depth * (1 - x * x));
      rim = Math.max(rim, k.depth * 0.45 * Math.exp(-((x - 1) * (x - 1)) / 0.04));
    }
    const r = 1 + n * 0.42 + ridge * ridge * 0.1 + grit * 0.035 + crater + rim;
    v.multiplyScalar(r);
    v.x *= 1.25;
    v.y *= 0.78;
    v.z *= 1.08;
    const top = v.y > FLAT_Y;
    if (top) v.y = FLAT_Y + (v.y - FLAT_Y) * 0.12; // flat top for the deck
    p.setXYZ(i, v.x, v.y, v.z);
    // Colour: tinted rock, darker in crater bowls and crevices, dusty on rims and ridges.
    const shade = 0.5 + 0.9 * (0.5 + fbm(v.x * 5 + 3, v.y * 5, v.z * 5, 2));
    const cavity = THREE.MathUtils.clamp(1 + crater * 9 - (1 - ridge) * 0.25, 0.35, 1.1);
    c.copy(base)
      .lerp(tc, 0.24 + 0.14 * (n + 0.5))
      .lerp(dust, THREE.MathUtils.clamp(rim * 10 + grit * 0.6, 0, 0.45))
      .multiplyScalar(shade * cavity * (top ? 1.1 : 1));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

/** A small lumpy boulder or belt rock (keeps UVs so a bump map works). */
export function pebbleGeometry(seed: number, detail = 2): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(1, detail);
  const p = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const stretch = new THREE.Vector3(
    0.8 + ((seed * 7) % 5) / 10,
    0.6 + ((seed * 3) % 4) / 10,
    0.8 + ((seed * 5) % 3) / 10,
  );
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const r = 1 + fbm(v.x * 1.8 + seed, v.y * 1.8, v.z * 1.8, 3) * 0.55;
    v.multiplyScalar(r).multiply(stretch);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

// Stored rocks from older versions of this code are ignored (see stored.ts).
setVersions({ rock: fingerprint(buildRock, makeCraters, fbm, perlin.noise) });
