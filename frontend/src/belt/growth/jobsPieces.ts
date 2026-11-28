// Opportunity Office's own upgrade pieces, in ladder order. Deck coordinates:
// the deck's centre, y = 0 on its top. The building-view camera looks from -z
// toward +z, so nothing tall stands between it and the desk.
import * as THREE from "three";

import { mulberry32 } from "../../interior/robotBrain.ts";
import type { Kit } from "../materials.ts";
import { DECK_R } from "./deck.ts";
import type { Ground } from "./ground.ts";
import {
  builder,
  chaseLamps,
  noClicks,
  palette,
  polar,
  still,
  type Builder,
  type Palette,
  type Piece,
} from "./parts.ts";
import {
  annulus,
  LOWER_Y,
  LOWER_WIDTH,
  lowerInner,
  PAD_AT,
  REACH_DEGREES,
} from "./sharedPieces.ts";

/** Where Flight School's landmark stands: its own pad at the back, to the right of the screen. */
export const LANDMARK_SPOT = polar(137, 2.5);
/**
 * Where Opportunity Office's radar dish stands, at every stage: on a platform of its
 * own, well out past the deck and a little below it, to the back left of the building
 * view. That keeps the turning dish clear of the robot, desk and screen.
 */
export const DISH_SPOT = polar(82, 9.1, -0.9);
/** The grown radar dish's head height over its platform at each landmark stage. */
export const DISH_HEIGHT = { 2: 1.9, 3: 2.2, 4: 2.55 } as const;
export const RING2_OUTER = 4.3;

/** The rock's top at a spot, never so low that a building would hang off the side. */
const footing = (ground: Ground, at: THREE.Vector3) => Math.max(-0.9, ground.top(at.x, at.z));

export function deckEdgeLights(tint: string, kit: Kit): Piece {
  const c = palette(tint, kit);
  const group = new THREE.Group();
  const b = builder(kit);
  const spots: THREE.Vector3[] = [];
  for (let k = 0; k < 24; k++) {
    const at = polar(k * 15 + 7, DECK_R + 0.02);
    b.cylinder(0.05, 0.08, 0.14, c.dark, [at.x, 0.07, at.z], { sides: 8, near: true });
    spots.push(at.setY(0.17));
  }
  b.hoop(DECK_R + 0.24, 0.05, c.lit, [0, -0.2, 0]);
  b.into(group);
  return { group, update: chaseLamps(kit, group, spots, 0.043, c.lamp) };
}

/** A crater: a raised ring of rock around a bowl, sitting on the ground at `at`. */
function craterRim(b: Builder, c: Palette, at: THREE.Vector3, r: number): void {
  b.add(new THREE.TorusGeometry(r, r * 0.24, 7, 22), c.rock, at, {
    turn: [Math.PI / 2, 0, 0],
    size: [1, 1, 0.8],
  });
  const rng = mulberry32(Math.round(r * 1000));
  for (let k = 0; k < 9; k++) {
    const spot = polar(k * 40 + rng() * 25, r * (1.02 + rng() * 0.2)).add(at);
    b.add(new THREE.IcosahedronGeometry(r * (0.1 + rng() * 0.1), 0), c.rock, spot, {
      turn: [rng() * 3, rng() * 3, 0],
    });
  }
}

/** A crater lit from inside in the building's colour, with a shaft of light. */
export function litCrater(tint: string, kit: Kit, ground: Ground): Piece {
  const c = palette(tint, kit);
  const spot = polar(205, 4.8);
  spot.y = footing(ground, spot) + 0.14;
  const piece = still(kit, (b) => {
    craterRim(b, c, spot, 0.95);
    b.cylinder(0.85, 0.85, 0.06, c.soft, [spot.x, spot.y, spot.z], { sides: 28 });
    b.cylinder(0.42, 0.42, 0.09, c.lit, [spot.x, spot.y + 0.02, spot.z], { sides: 24 });
    b.add(new THREE.CylinderGeometry(1.0, 0.7, 1.3, 24, 1, true), c.beam(0.12), [
      spot.x,
      spot.y + 0.65,
      spot.z,
    ]);
  });
  return piece;
}

/** The deck grows a second ring around the first, with its own lit edge and windows. */
export function deckRing2(tint: string, kit: Kit, ground: Ground): Piece {
  const c = palette(tint, kit);
  return still(kit, (b) => {
    annulus(b, DECK_R + 0.3, RING2_OUTER, -0.04, 0.26, c.dark);
    annulus(b, DECK_R + 0.55, RING2_OUTER - 0.25, -0.01, 0.05, c.deep);
    b.hoop(RING2_OUTER + 0.02, 0.07, c.lit, [0, -0.05, 0]);
    for (let k = 0; k < 12; k++) {
      const degrees = k * 30 + 15;
      const turn: [number, number, number] = [0, (-degrees * Math.PI) / 180, 0];
      // Link spokes back to the first deck, and lit windows on the new edge.
      b.box(0.55, 0.09, 0.3, c.steel, polar(degrees, DECK_R + 0.25, -0.08), { turn });
      for (const off of [-8, 0, 8]) {
        b.box(0.04, 0.11, 0.2, c.white_lamp, polar(degrees + off, RING2_OUTER + 0.01, -0.19), {
          turn: [0, (-(degrees + off) * Math.PI) / 180, 0],
          near: true,
        });
      }
      const under = polar(degrees, RING2_OUTER - 0.35, -0.28);
      const foot = polar(degrees, RING2_OUTER - 0.75, footing(ground, under) - 0.25);
      b.rod(foot, under, 0.07, c.steel, { near: true });
    }
  });
}

/** Rings of signal spreading from the grown dish. */
export function signalRings(tint: string, kit: Kit): Piece {
  const c = palette(tint, kit);
  const group = new THREE.Group();
  group.position.copy(DISH_SPOT);
  const geo = kit.keep(new THREE.TorusGeometry(1, 0.018, 6, 64));
  const rings = [0, 1, 2].map(() => {
    const material = c.beam(0.8);
    const ring = new THREE.Mesh(geo, material);
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
    return { ring, material };
  });
  noClicks(group);
  return {
    group,
    update(t) {
      rings.forEach(({ ring, material }, i) => {
        const k = (t * 0.28 + i / 3) % 1;
        // Rising and widening above the dishes.
        ring.position.y = DISH_HEIGHT[3] + 0.4 + k * 3.2;
        ring.scale.setScalar(0.5 + k * 1.9);
        material.opacity = 0.85 * (1 - k);
      });
    },
  };
}

/** A glass habitat dome built into a crater, its windows glowing, with an entrance tube. */
export function habitatDome(tint: string, kit: Kit, ground: Ground): Piece {
  const c = palette(tint, kit);
  const spot = polar(163, 5.5);
  spot.y = footing(ground, spot) + 0.08;
  return still(kit, (b) => {
    craterRim(b, c, spot, 1.38);
    const half = (r: number) => new THREE.SphereGeometry(r, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    b.add(half(1.22), c.glass, spot);
    b.add(half(0.62), c.lit, spot, { size: [1, 0.8, 1] }); // the lit home inside
    for (let k = 0; k < 4; k++) {
      b.add(new THREE.TorusGeometry(1.23, 0.035, 5, 32, Math.PI), c.hull, spot, {
        turn: [0, (k * Math.PI) / 4, 0],
      });
    }
    b.hoop(1.25, 0.08, c.hull, [spot.x, spot.y + 0.12, spot.z]);
    for (let k = 0; k < 12; k++) {
      const degrees = k * 30;
      b.box(0.1, 0.18, 0.24, c.white_lamp, polar(degrees, 1.2, 0.3).add(spot), {
        turn: [0, (-degrees * Math.PI) / 180, 0],
      });
    }
    const door = polar(163, RING2_OUTER - 0.1, -0.02);
    const hatch = polar(163 + 180, 1.15, 0.28).add(spot);
    b.rod(door.setY(0.05), hatch, 0.24, c.hull, { sides: 12 });
    b.rod(door.clone().lerp(hatch, 0.45), door.clone().lerp(hatch, 0.55), 0.27, c.lit, {
      sides: 12,
    });
    b.rod(
      new THREE.Vector3(spot.x, spot.y + 1.2, spot.z),
      new THREE.Vector3(spot.x, spot.y + 1.85, spot.z),
      0.025,
      c.steel,
    );
    b.ball(0.08, c.lamp, [spot.x, spot.y + 1.9, spot.z]);
  });
}

const RIG_SPOT = polar(331, 5.2);

/** A drilling rig on the rock's shoulder, its drill turning in a glowing cut. */
export function miningRig(tint: string, kit: Kit, ground: Ground): Piece {
  const c = palette(tint, kit);
  const spot = RIG_SPOT.clone().setY(footing(ground, RIG_SPOT));
  const group = new THREE.Group();
  const b = builder(kit);
  b.cylinder(1.0, 1.1, 0.2, c.dark, [spot.x, spot.y + 0.1, spot.z], { sides: 20 });
  b.hoop(0.62, 0.07, c.lit, [spot.x, spot.y + 0.22, spot.z]);
  b.lattice(spot.clone().setY(spot.y + 0.2), 2.9, 1.15, 0.45, c.steel);
  b.box(0.75, 0.4, 0.75, c.paint, [spot.x, spot.y + 3.25, spot.z]);
  b.box(0.8, 0.07, 0.8, c.lit, [spot.x, spot.y + 3.02, spot.z]);
  // Ore skip and conveyor back toward the deck.
  const hopper = polar(318, 4.65, footing(ground, polar(318, 4.65)) + 0.3);
  b.box(0.7, 0.45, 0.55, c.paint, hopper);
  b.rod(spot.clone().setY(spot.y + 0.35), hopper, 0.09, c.dark);
  b.into(group);
  const drill = new THREE.Group();
  drill.position.set(spot.x, spot.y + 0.2, spot.z);
  const d = builder(kit);
  d.cylinder(0.09, 0.09, 2.5, c.dark, [0, 1.6, 0]);
  d.add(new THREE.ConeGeometry(0.3, 0.6, 8), c.steel, [0, 0.35, 0], { turn: [Math.PI, 0, 0] });
  for (const y of [0.9, 1.5, 2.1]) d.box(0.5, 0.09, 0.09, c.paint, [0, y, 0]);
  d.into(drill);
  const spark = new THREE.Mesh(kit.keep(new THREE.OctahedronGeometry(0.14, 0)), c.lamp);
  const beacon = new THREE.Mesh(kit.keep(new THREE.SphereGeometry(0.13, 10, 8)), c.lamp);
  beacon.position.set(spot.x, spot.y + 3.6, spot.z);
  group.add(drill, spark, beacon);
  return {
    group,
    update(t) {
      drill.rotation.y = t * 7;
      drill.position.y = spot.y + 0.2 + Math.sin(t * 1.1) * 0.14;
      spark.position.set(
        spot.x + Math.cos(t * 9) * 0.45,
        spot.y + 0.3 + Math.abs(Math.sin(t * 13)) * 0.35,
        spot.z + Math.sin(t * 9) * 0.45,
      );
      beacon.scale.setScalar(0.8 + 0.5 * Math.max(0, Math.sin(t * 4)));
    },
  };
}

/** Glowing mineral seams cut open down the rock's sides. */
export function minedSeams(tint: string, kit: Kit, ground: Ground): Piece {
  const c = palette(tint, kit);
  return still(kit, (b) => {
    const rng = mulberry32(5150);
    for (const start of [354, 22, 108, 196, 262, 322]) {
      const walk = (degrees: number, y: number, steps: number, thick: number) => {
        const points: THREE.Vector3[] = [];
        let a = degrees;
        let h = y;
        for (let k = 0; k <= steps; k++) {
          const r = ground.radius((a * Math.PI) / 180, h);
          points.push(polar(a, r + 0.02, h));
          a += (k % 2 ? -1 : 1) * (4 + rng() * 7) + 2.5;
          h -= 0.24 + rng() * 0.14;
        }
        b.pipe(points, thick, c.lit);
        return points;
      };
      const main = walk(start, -0.55, 6, 0.075);
      walk(start + 6, main[2]!.y, 3, 0.045);
      // Crystals broken open along the seam.
      for (const point of [main[1]!, main[3]!, main[5]!]) {
        b.add(new THREE.OctahedronGeometry(0.2, 0), c.lamp, point, {
          turn: [rng() * 3, rng() * 3, rng() * 3],
          size: [0.6, 1.3, 0.6],
        });
      }
    }
  });
}

/** A truss arm reaching past the asteroid's edge to a round landing pad. */
export function outrigger(tint: string, kit: Kit, ground: Ground): Piece {
  const c = palette(tint, kit);
  const group = new THREE.Group();
  const b = builder(kit);
  const across = polar(REACH_DEGREES + 90, 0.38);
  const from = RING2_OUTER - 0.1;
  const to = PAD_AT.length() - 1.3;
  const bays = 6;
  const chord = (k: number, side: number, y: number) =>
    polar(REACH_DEGREES, from + ((to - from) * k) / bays, y).addScaledVector(across, side);
  for (let k = 0; k < bays; k++) {
    for (const side of [-1, 1]) {
      b.rod(chord(k, side, 0), chord(k + 1, side, 0), 0.07, c.steel);
      b.rod(chord(k, side, -0.55), chord(k + 1, side, -0.55), 0.05, c.steel);
      b.rod(chord(k, side, -0.55), chord(k, side, 0), 0.035, c.steel);
      b.rod(chord(k, side, -0.55), chord(k + 1, side, 0), 0.025, c.steel, { near: true });
    }
    b.rod(chord(k + 1, -1, 0), chord(k + 1, 1, 0), 0.04, c.steel);
  }
  b.box(to - from, 0.07, 0.6, c.deep, polar(REACH_DEGREES, (from + to) / 2, 0.04), {
    turn: [0, (-REACH_DEGREES * Math.PI) / 180, 0],
  });
  b.cylinder(1.4, 1.2, 0.2, c.dark, [PAD_AT.x, 0, PAD_AT.z], { sides: 32 });
  b.hoop(1.4, 0.07, c.lit, [PAD_AT.x, 0.1, PAD_AT.z]);
  b.hoop(0.9, 0.035, c.soft, [PAD_AT.x, 0.12, PAD_AT.z]);
  // A brace from the pad down to the rock.
  const hold = polar(
    REACH_DEGREES,
    ground.radius((REACH_DEGREES * Math.PI) / 180, -1.8) - 0.2,
    -1.8,
  );
  b.rod(hold, PAD_AT.clone().setY(-0.2), 0.11, c.paint);
  b.into(group);
  const lamps = Array.from({ length: 12 }, (_, k) =>
    polar(k * 30, 1.28, 0.16).add(PAD_AT.clone().setY(0)),
  );
  return { group, update: chaseLamps(kit, group, lamps, 0.08, c.lamp, 4) };
}

/** Lit footbridges arching from the upper deck down to the lower one. */
export function walkwayBridges(tint: string, kit: Kit, ground: Ground): Piece {
  const c = palette(tint, kit);
  const reach = lowerInner(ground) + LOWER_WIDTH * 0.35;
  return still(kit, (b) => {
    for (const degrees of [48, 104, 232, 292]) {
      const curve = new THREE.QuadraticBezierCurve3(
        polar(degrees, RING2_OUTER - 0.15, 0),
        polar(degrees, (RING2_OUTER + reach) / 2 + 0.5, 0.35),
        polar(degrees, reach, LOWER_Y + 0.06),
      );
      const across = polar(degrees + 90, 0.28);
      const points = curve.getPoints(12);
      for (let k = 0; k < 12; k++) {
        const [p, q] = [points[k]!, points[k + 1]!];
        const mid = p.clone().lerp(q, 0.5);
        const slope = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(1, 0, 0),
          q.clone().sub(p).normalize(),
        );
        b.box(p.distanceTo(q) + 0.03, 0.08, 0.56, c.dark, mid, { turn: slope });
        for (const side of [-1, 1]) {
          const lift = new THREE.Vector3(0, 0.24, 0);
          const edge = across.clone().multiplyScalar(side);
          b.rod(p.clone().add(edge).add(lift), q.clone().add(edge).add(lift), 0.035, c.lit);
          b.rod(p.clone().add(edge), p.clone().add(edge).add(lift), 0.02, c.steel, { near: true });
        }
      }
    }
  });
}

const ARRAY_SPOT = polar(238, 5.2);

/** A deep-space array: a tall emitter ringed by small dishes, beaming to the station. */
export function deepSpaceArray(tint: string, kit: Kit, ground: Ground): Piece {
  const c = palette(tint, kit);
  const spot = ARRAY_SPOT.clone().setY(footing(ground, ARRAY_SPOT));
  const top = 3.9;
  const group = new THREE.Group();
  const b = builder(kit);
  b.cylinder(1.15, 1.3, 0.22, c.dark, [spot.x, spot.y + 0.1, spot.z], { sides: 24 });
  b.hoop(1.15, 0.06, c.lit, [spot.x, spot.y + 0.22, spot.z]);
  b.lattice(spot.clone().setY(spot.y + 0.2), top - spot.y - 0.2, 0.8, 0.22, c.paint, 5);
  const bowl = () =>
    new THREE.LatheGeometry(
      Array.from({ length: 7 }, (_, i) => new THREE.Vector2(i * 0.1, (i * 0.1) ** 2 * 0.6)),
      24,
    );
  for (let k = 0; k < 4; k++) {
    const foot = polar(k * 90 + 20, 0.85, spot.y + 0.2).add(spot.clone().setY(0));
    const head = foot.clone().setY(foot.y + 0.75);
    b.rod(foot, head, 0.06, c.steel);
    const tilt = new THREE.Quaternion().setFromAxisAngle(polar(k * 90 + 110, 1), -0.55);
    b.add(bowl(), c.white, head, { turn: tilt });
    b.ball(0.07, c.lamp, head.clone().setY(head.y + 0.35));
  }
  for (const [y, r] of [
    [top - 0.55, 0.42],
    [top - 0.25, 0.3],
  ] as const) {
    b.hoop(r, 0.05, c.lit, [spot.x, y, spot.z]);
  }
  b.into(group);
  const core = new THREE.Mesh(kit.keep(new THREE.OctahedronGeometry(0.3, 1)), c.lamp);
  core.position.set(spot.x, top + 0.1, spot.z);
  group.add(core);

  // The beam: it leaves level (above the desk and camera) and points at the station.
  const beam = new THREE.Group();
  beam.position.copy(core.position);
  const shaftGeo = kit.keep(new THREE.CylinderGeometry(0.09, 0.09, 1, 10, 1, true));
  shaftGeo.translate(0, 0.5, 0);
  const shaft = new THREE.Mesh(shaftGeo, c.beam(0.35));
  const pulseGeo = kit.keep(new THREE.SphereGeometry(0.2, 10, 8));
  const pulses = [0, 1, 2].map(() => new THREE.Mesh(pulseGeo, c.lamp));
  beam.add(shaft, ...pulses);
  beam.traverse((o) => (o.userData.reaches = true));
  noClicks(beam);
  group.add(beam);
  const station = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  let length = 12;
  let now = 0;
  const run = () => {
    shaft.scale.y = length;
    pulses.forEach((p, i) => (p.position.y = ((now * 0.35 + i / 3) % 1) * length));
  };
  return {
    group,
    update(t) {
      now = t;
      core.rotation.y = t;
      core.scale.setScalar(1 + 0.18 * Math.sin(t * 5));
      run();
    },
    aim() {
      if (!group.parent) return;
      group.parent.updateWorldMatrix(true, false);
      // The station is at the world's middle; aim level with the emitter.
      const height = group.parent.localToWorld(station.copy(core.position)).y;
      group.parent.worldToLocal(station.set(0, height, 0));
      station.sub(core.position).setY(0);
      // Stop well short, so the beam never pierces the station.
      length = Math.max(4, station.length() * 0.68);
      if (station.lengthSq() > 1e-6) beam.quaternion.setFromUnitVectors(up, station.normalize());
      run();
    },
  };
}
