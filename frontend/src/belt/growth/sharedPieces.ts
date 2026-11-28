// Pieces more than one building uses: the parked shuttle, the lower deck and the
// captured moonlet (with what rides on it).
import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

import type { Kit } from "../materials.ts";
import type { Ground } from "./ground.ts";
import { builder, chaseLamps, palette, polar, still, type Piece } from "./parts.ts";

/** Which way the outrigger arm and runway strip reach (degrees; 0 = +x). */
export const REACH_DEGREES = 15;
/** The outrigger's landing pad, deck coordinates; the shuttle parks on it. */
export const PAD_AT = polar(REACH_DEGREES, 8.4, 0.1);

/** A small shuttle standing on its skids. Its group sits on the outrigger's pad. */
export function parkedShuttle(tint: string, kit: Kit): Piece {
  const c = palette(tint, kit);
  const piece = still(kit, (b) => {
    const along: [number, number, number] = [Math.PI / 2, 0, 0]; // cylinders lie along z
    b.add(new THREE.CapsuleGeometry(0.34, 1.0, 6, 16), c.hull, [0, 0.52, 0], { turn: along });
    b.ball(0.26, c.glass, [0, 0.66, 0.52], { size: [0.9, 0.75, 1.15] });
    b.cylinder(0.355, 0.355, 0.16, c.paint, [0, 0.52, 0.1], { turn: along, sides: 20 });
    for (const side of [-1, 1]) {
      b.box(0.82, 0.07, 0.5, c.paint, [side * 0.6, 0.42, -0.32], { turn: [0, side * 0.35, 0] });
      b.box(0.06, 0.34, 0.34, c.hull, [side * 0.98, 0.56, -0.5]);
      b.cylinder(0.13, 0.17, 0.46, c.dark, [side * 0.36, 0.44, -0.72], { turn: along });
      b.cylinder(0.11, 0.11, 0.03, c.lit, [side * 0.36, 0.44, -0.97], { turn: along });
      b.box(0.07, 0.05, 1.05, c.steel, [side * 0.32, 0.04, -0.02]); // skid
      for (const z of [-0.35, 0.35]) {
        b.box(0.05, 0.22, 0.05, c.steel, [side * 0.3, 0.16, z], { near: true });
      }
      b.ball(0.05, c.white_lamp, [side * 1.0, 0.75, -0.5]);
    }
    b.box(0.07, 0.42, 0.36, c.paint, [0, 0.98, -0.52], { turn: [-0.25, 0, 0] });
  });
  piece.group.position.copy(PAD_AT);
  piece.group.rotation.y = -1.1;
  return piece;
}

/** The lower deck's height, and how wide it is. */
export const LOWER_Y = -1.35;
export const LOWER_WIDTH = 0.95;
export const lowerInner = (ground: Ground): number =>
  Math.min(8.3, ground.maxRadius(LOWER_Y) + 0.2);

/** A second deck: a wide platform circling the rock's waist, on struts. */
export function twoLevelDeck(tint: string, kit: Kit, ground: Ground): Piece {
  const c = palette(tint, kit);
  const inner = lowerInner(ground);
  const outer = inner + LOWER_WIDTH;
  const group = new THREE.Group();
  const b = builder(kit);
  annulus(b, inner, outer, LOWER_Y, 0.2, c.dark);
  annulus(b, inner + 0.2, outer - 0.2, LOWER_Y + 0.025, 0.04, c.deep);
  b.hoop(outer, 0.07, c.lit, [0, LOWER_Y + 0.02, 0]);
  b.hoop(inner, 0.035, c.soft, [0, LOWER_Y + 0.02, 0]);
  for (let k = 0; k < 40; k++) {
    const degrees = k * 9 + 4;
    // Lit windows round the platform's edge.
    const at = polar(degrees, outer + 0.015, LOWER_Y - 0.1);
    b.box(0.04, 0.1, 0.34, c.white_lamp, at, { turn: [0, (-degrees * Math.PI) / 180, 0] });
  }
  for (let k = 0; k < 12; k++) {
    const degrees = k * 30 + 12;
    const foot = polar(degrees, ground.radius((degrees * Math.PI) / 180, -2.3) - 0.2, -2.3);
    const under = polar(degrees, inner + 0.35, LOWER_Y - 0.18);
    b.rod(foot, under, 0.07, c.steel);
    b.rod(
      polar(degrees, inner + 0.1, LOWER_Y - 0.12),
      polar(degrees, inner - 0.9, LOWER_Y),
      0.05,
      c.steel,
    );
  }
  b.into(group);
  const lamps = Array.from({ length: 24 }, (_, k) => polar(k * 15, outer - 0.08, LOWER_Y + 0.12));
  return { group, update: chaseLamps(kit, group, lamps, 0.07, c.lamp) };
}

/** A flat ring-shaped slab with its top at `y`. */
export function annulus(
  b: ReturnType<typeof builder>,
  inner: number,
  outer: number,
  y: number,
  thick: number,
  material: THREE.Material,
): void {
  const section = [
    new THREE.Vector2(inner, -thick),
    new THREE.Vector2(outer, -thick),
    new THREE.Vector2(outer, 0),
    new THREE.Vector2(inner, 0),
    new THREE.Vector2(inner, -thick),
  ];
  // LatheGeometry shares corner normals; flat faces keep the edges crisp.
  const lathe = new THREE.LatheGeometry(section, 96).toNonIndexed();
  lathe.computeVertexNormals();
  b.add(lathe, material, [0, y, 0]);
}

/** Where the captured moonlet is at time t: a slow orbit above and outside everything else. */
export function moonletPose(t: number, out = new THREE.Vector3()): THREE.Vector3 {
  const a = 2.2 + t * 0.11;
  return out.set(Math.cos(a) * 8.4, 7.9 + Math.sin(t * 0.37) * 0.25, Math.sin(a) * 8.4);
}

const MOONLET_R = 1.15;

/** A lumpy captured rock with craters and a glowing tether collar. */
export function moonlet(tint: string, kit: Kit): Piece {
  const c = palette(tint, kit);
  const piece = still(kit, (b) => {
    let rock: THREE.BufferGeometry = new THREE.IcosahedronGeometry(MOONLET_R, 5);
    rock.deleteAttribute("normal");
    rock.deleteAttribute("uv");
    rock = mergeVertices(rock);
    const p = rock.attributes.position as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).normalize();
      const lump =
        Math.sin(v.x * 3.1 + 1) * Math.sin(v.y * 4.3) * 0.13 +
        Math.sin(v.z * 7.7 + v.x * 5) * 0.06 +
        Math.sin(v.y * 11 + v.z * 9) * 0.035;
      v.multiplyScalar(MOONLET_R * (1 + lump));
      p.setXYZ(i, v.x * 1.15, v.y * 0.85, v.z);
    }
    const facets = rock.toNonIndexed(); // flat faces, like the boulders
    facets.computeVertexNormals();
    facets.setAttribute(
      "uv",
      new THREE.BufferAttribute(new Float32Array(facets.attributes.position!.count * 2), 2),
    );
    b.add(facets, c.rock);
    b.hoop(MOONLET_R * 1.22, 0.05, c.lit, [0, -0.08, 0]);
    for (let k = 0; k < 4; k++) {
      b.ball(0.09, c.lamp, polar(k * 90 + 30, MOONLET_R * 1.22, -0.08));
    }
  });
  piece.update = (t) => {
    moonletPose(t, piece.group.position);
    piece.group.rotation.y = t * 0.17;
  };
  return piece;
}

/** A relay station on the moonlet: a dish, an antenna and a pulsing beacon. */
export function moonletRelay(tint: string, kit: Kit): Piece {
  const c = palette(tint, kit);
  const group = new THREE.Group();
  const top = MOONLET_R * 0.8;
  const b = builder(kit);
  b.cylinder(0.42, 0.5, 0.24, c.dark, [0, top, 0]);
  b.cylinder(0.07, 0.1, 0.8, c.steel, [-0.12, top + 0.5, 0]);
  const bowl = new THREE.LatheGeometry(
    Array.from({ length: 7 }, (_, i) => new THREE.Vector2(i * 0.13, (i * 0.13) ** 2 * 0.5)),
    28,
  );
  b.add(bowl, c.white, [-0.12, top + 0.92, 0], { turn: [0, 0, -0.75] });
  b.hoop(0.8, 0.025, c.lit, [-0.12, top + 0.16, 0], { near: true });
  b.rod(new THREE.Vector3(0.28, top, 0), new THREE.Vector3(0.28, top + 1.35, 0), 0.03, c.steel);
  b.into(group);
  const beaconGeo = kit.keep(new THREE.SphereGeometry(0.12, 10, 8));
  const beacon = new THREE.Mesh(beaconGeo, c.lamp);
  beacon.position.set(0.28, top + 1.4, 0);
  const relay = new THREE.Group();
  while (group.children.length) relay.add(group.children[0]!);
  relay.add(beacon);
  group.add(relay);
  return {
    group,
    update(t) {
      moonletPose(t, group.position);
      relay.rotation.y = t * 0.3;
      beacon.scale.setScalar(1 + 0.5 * Math.max(0, Math.sin(t * 3)));
    },
  };
}

/** Training drones flying tilted laps around the moonlet, each with a light trail. */
export function trainingDrones(tint: string, kit: Kit): Piece {
  const c = palette(tint, kit);
  const group = new THREE.Group();
  const bodyGeo = kit.keep(new THREE.OctahedronGeometry(0.22, 0));
  const eyeGeo = kit.keep(new THREE.SphereGeometry(0.09, 8, 6));
  const trailGeo = kit.keep(new THREE.TorusGeometry(2.0, 0.018, 4, 40, 1.3));
  const trailMat = c.beam(0.5);
  const drones = [0, 1, 2, 3].map((i) => {
    const lane = new THREE.Group();
    lane.rotation.set(0.35 * (i % 2 ? 1 : -1), (i * Math.PI) / 4, 0.2 * (i - 1.5));
    const runner = new THREE.Group();
    const drone = new THREE.Group();
    drone.position.set(2.0, 0, 0);
    const body = new THREE.Mesh(bodyGeo, c.hull);
    body.scale.set(0.8, 0.55, 1.3);
    const eye = new THREE.Mesh(eyeGeo, c.lamp);
    eye.position.y = 0.12;
    drone.add(body, eye);
    const trail = new THREE.Mesh(trailGeo, trailMat);
    // The arc lies flat and ends just behind the drone.
    trail.rotation.set(Math.PI / 2, 0, -1.34);
    runner.add(drone, trail);
    lane.add(runner);
    group.add(lane);
    return runner;
  });
  return {
    group,
    update(t) {
      moonletPose(t, group.position);
      drones.forEach((r, i) => (r.rotation.y = -t * (0.9 + i * 0.13) - i * 1.7));
    },
  };
}
