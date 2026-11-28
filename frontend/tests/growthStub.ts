// The growth tests' stand-in for a built asteroid and its design kit.
import * as THREE from "three";

import { createGrowth } from "../src/belt/growth/applyGrowth.ts";
import { DECK_Y, ROCK_SCALE } from "../src/belt/growth/deck.ts";
import { rockGround } from "../src/belt/growth/ground.ts";
import { createLandmark } from "../src/belt/landmarks.ts";
import type { Kit } from "../src/belt/materials.ts";
import { rockGeometry } from "../src/belt/space/rock.ts";

export type Asteroid = "jobs" | "career";
export const ASTEROIDS: Asteroid[] = ["jobs", "career"];
/** Each one's tint and rock, as in space/orbit.ts and asteroids.ts. */
export const LOOKS = {
  jobs: { tint: "#41c9d6", seed: 1.3 },
  career: { tint: "#9b7bff", seed: 5 * 3.7 + 1.3 },
} as const;

/** The design kit without a browser: plain materials, and a note of what it must free. */
export function stubKit() {
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
export function groundOf(id: Asteroid) {
  let g = grounds.get(id);
  if (!g) {
    g = rockGround(rockGeometry(LOOKS[id].seed, LOOKS[id].tint), ROCK_SCALE, DECK_Y);
    grounds.set(id, g);
  }
  return g;
}

/** An asteroid's growth on its own: the same groups asteroids.ts hands over. */
export function make(id: Asteroid, built = true) {
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

export const shown = (o: THREE.Object3D): boolean => o.visible && (!o.parent || shown(o.parent));
