// Mission Control's and the Vault's outside upgrades. Coordinates are the module's
// own: its centre at the origin, its long axis along x, +y up, +z toward the hatch
// side (the front, seen from the home view). The hub is 10.5 along x: toward +x for
// Mission Control, toward -x for the Vault. See station.ts for what's already there.
//
// Keep clear of: the end solar wings (|x| 5 to 8.4), the dish Mission Control starts
// with (x 0.4 to 2.6, up to y 3.7), the Vault's radiators (y ±3.3) and bar chart
// (front, x -2.4 to 2), and the way in to the hatch.
import * as THREE from "three";

import { MODULE_X } from "../../interior/stationLayout.ts";
import type { Kit } from "../materials.ts";
import { builder, chaseLamps, noClicks, palette, still, type Piece } from "./parts.ts";

/** Hull radius of each module (the Vault's is its eight-sided body's corners). */
const HULL = { planner: 2.15, finance: 2.25 } as const;

const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** A point on a module's side: `degrees` from the front (+z) toward the top (+y). */
const onHull = (x: number, degrees: number, radius: number) => {
  const a = (degrees * Math.PI) / 180;
  return v3(x, Math.sin(a) * radius, Math.cos(a) * radius);
};
/** A hoop round the module's long axis. */
function collar(
  b: ReturnType<typeof builder>,
  radius: number,
  tube: number,
  material: THREE.Material,
  x: number,
  o: { near?: boolean; sides?: number; turn?: number } = {},
) {
  const shape = new THREE.TorusGeometry(radius, tube, 8, o.sides ?? 72);
  if (o.turn) shape.rotateZ(o.turn);
  b.add(shape, material, [x, 0, 0], { turn: [0, Math.PI / 2, 0], near: o.near });
}

/** A lamp on its own, so it can pulse. */
function pulseLamp(
  kit: Kit,
  parent: THREE.Object3D,
  at: THREE.Vector3,
  size: number,
  material: THREE.Material,
): THREE.Mesh {
  const lamp = new THREE.Mesh(kit.keep(new THREE.SphereGeometry(size, 12, 10)), material);
  lamp.position.copy(at);
  parent.add(lamp);
  return lamp;
}

// --- Mission Control ----------------------------------------------------------

/** Level 10: lamps chasing along the hull, and a lit ring at each end. */
export function hullLights(tint: string, kit: Kit): Piece {
  const c = palette(tint, kit);
  const group = new THREE.Group();
  const b = builder(kit);
  const radius = HULL.planner + 0.04;
  for (const degrees of [28, -28, 152]) {
    b.rod(onHull(-3.9, degrees, radius), onHull(3.9, degrees, radius), 0.045, c.soft);
  }
  for (const x of [-3.9, 3.9]) collar(b, radius + 0.02, 0.07, c.lit, x);
  b.into(group);
  const spots = [28, -28, 152].flatMap((degrees) =>
    Array.from({ length: 15 }, (_, i) => onHull(-3.62 + i * 0.52, degrees, radius + 0.08)),
  );
  return { group, update: chaseLamps(kit, group, spots, 0.09, c.lamp) };
}

/** Level 20: a tall second antenna leaning out past the module's far end. */
export function extraAntenna(tint: string, kit: Kit): Piece {
  const c = palette(tint, kit);
  const group = new THREE.Group();
  const b = builder(kit);
  const base = v3(-3.85, 1.95, 0);
  const tip = v3(-4.55, 5.3, 0);
  const along = (k: number) => base.clone().lerp(tip, k);
  b.cylinder(0.3, 0.4, 0.3, c.dark, base);
  b.rod(base, along(0.62), 0.09, c.steel, { sides: 8 });
  b.rod(along(0.62), tip, 0.05, c.hull);
  for (const [k, half] of [
    [0.45, 0.8],
    [0.64, 0.62],
    [0.82, 0.44],
  ] as const) {
    const at = along(k);
    b.rod(at.clone().setZ(-half), at.clone().setZ(half), 0.04, c.hull);
    for (const z of [-half, half]) {
      b.ball(0.085, c.lamp, at.clone().setZ(z));
      b.rod(
        at.clone().setZ(z),
        at
          .clone()
          .setZ(z)
          .setY(at.y + 0.3),
        0.018,
        c.steel,
        {
          near: true,
        },
      );
    }
    collar(b, 0.12, 0.03, c.lit, at.x, { near: true, sides: 16 });
  }
  for (const z of [-0.9, 0.9]) b.rod(along(0.5), v3(-3.2, 1.9, z * 0.9), 0.02, c.steel);
  b.into(group);
  const beacon = pulseLamp(kit, group, tip, 0.16, c.white_lamp);
  return {
    group,
    update(t) {
      beacon.scale.setScalar(0.8 + 0.5 * Math.max(0, Math.sin(t * 2.6)));
    },
  };
}

/** Level 30: a much bigger comms dish on the roof, slowly searching. */
export function roofDish(tint: string, kit: Kit): Piece {
  const c = palette(tint, kit);
  const group = new THREE.Group();
  const post = still(kit, (b) => {
    b.cylinder(0.55, 0.72, 0.4, c.dark, [-2.25, 2.2, 0], { sides: 24 });
    b.cylinder(0.2, 0.28, 2.3, c.hull, [-2.25, 3.3, 0], { sides: 16 });
    b.hoop(0.34, 0.05, c.lit, [-2.25, 3.0, 0]);
    for (const [x, z] of [
      [-0.8, 0.8],
      [-0.8, -0.8],
      [0.8, 0.8],
      [0.8, -0.8],
    ] as const) {
      b.rod(v3(-2.25 + x, 2.0, z), v3(-2.25, 3.4, 0), 0.05, c.steel);
    }
  });
  const head = new THREE.Group();
  head.position.set(-2.25, 4.55, 0);
  const tilt = new THREE.Group();
  tilt.rotation.x = 0.85; // the bowl faces up and toward the front
  const b = builder(kit);
  const R = 1.55;
  const depth = 0.52;
  const profile = Array.from({ length: 12 }, (_, i) => {
    const k = i / 11;
    return new THREE.Vector2(k * R, k * k * depth);
  });
  // A lathe only draws one face: the profile run backwards draws the inside.
  const bowl = new THREE.LatheGeometry(profile, 48);
  const inner = new THREE.LatheGeometry([...profile].reverse(), 48);
  inner.translate(0, 0.045, 0);
  b.add(bowl, c.deep);
  b.add(inner, c.white);
  b.hoop(R, 0.085, c.paint, [0, depth + 0.02, 0]);
  b.hoop(R + 0.05, 0.035, c.lit, [0, depth + 0.07, 0]);
  b.hoop(R * 0.55, 0.022, c.soft, [0, depth * 0.3 + 0.08, 0]);
  const feed = v3(0, 1.35, 0);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.5;
    b.rod(v3(Math.cos(a) * R, depth, Math.sin(a) * R), feed, 0.035, c.steel);
  }
  b.cylinder(0.16, 0.1, 0.26, c.dark, feed);
  b.ball(0.13, c.lamp, v3(0, 1.55, 0));
  b.cylinder(0.3, 0.3, 0.3, c.dark, [0, -0.1, 0]);
  b.into(tilt);
  head.add(tilt);
  group.add(post.group, head);
  return {
    group,
    update(t) {
      head.rotation.y = Math.sin(t * 0.17) * 0.4;
    },
  };
}

/** Level 40, both modules: two big solar wings fanned out behind. */
export function solarWings(tint: string, kit: Kit): Piece {
  const c = palette(tint, kit);
  return still(kit, (b) => {
    for (const up of [1, -1]) {
      const angle = up * 0.62; // radians above (or below) straight back
      const dir = v3(0, Math.sin(angle), -Math.cos(angle));
      const side = v3(0, Math.cos(angle), Math.sin(angle)); // the panel's face
      const root = v3(0, up * 1.35, -1.6);
      const at = (d: number, x = 0, off = 0) =>
        root.clone().addScaledVector(dir, d).addScaledVector(side, off).setX(x);
      const turn: [number, number, number] = [angle, 0, 0];
      b.rod(root, at(4.3), 0.11, c.steel, { sides: 8 });
      b.cylinder(0.24, 0.24, 0.5, c.dark, at(0.55), { turn: [0, 0, Math.PI / 2] });
      for (let k = 0; k < 3; k++) {
        const d = 1.35 + k * 1.15;
        for (const x of [-0.66, 0.66]) {
          b.box(1.15, 0.06, 1.0, c.solar, at(d, x), { turn });
          b.box(1.2, 0.03, 0.05, c.hull, at(d + 0.52, x), { turn, near: true });
        }
        b.rod(at(d - 0.55, -1.27), at(d - 0.55, 1.27), 0.035, c.steel);
      }
      for (const x of [-1.27, 1.27]) {
        b.rod(at(0.8, x), at(4.2, x), 0.05, c.paint);
        b.ball(0.1, c.lamp, at(4.25, x));
      }
      b.rod(at(4.2, -1.27), at(4.2, 1.27), 0.05, c.paint);
    }
  });
}

/** Level 60: a wide habitat collar ringed with lit windows, lamps running round it. */
export function windowRing(tint: string, kit: Kit): Piece {
  const c = palette(tint, kit);
  const group = new THREE.Group();
  const b = builder(kit);
  const OUT = 3.05;
  const X0 = -1.35;
  const X1 = 0.25;
  const mid = (X0 + X1) / 2;
  // The band's cross-section, turned round the module's axis (the lathe's y is our x).
  const section = [
    [2.7, X0],
    [OUT, X0 + 0.12],
    [OUT, X1 - 0.12],
    [2.7, X1],
    [2.7, X0],
  ].map(([r, x]) => new THREE.Vector2(r!, x!));
  const band = new THREE.LatheGeometry(section, 72).toNonIndexed();
  band.computeVertexNormals();
  b.add(band, c.hull, [0, 0, 0], { turn: [0, 0, -Math.PI / 2] });
  for (const x of [X0 + 0.1, X1 - 0.1]) collar(b, OUT + 0.01, 0.075, c.paint, x);
  collar(b, OUT + 0.02, 0.025, c.lit, mid);
  for (let k = 0; k < 36; k++) {
    const degrees = k * 10;
    const turn: [number, number, number] = [(-degrees * Math.PI) / 180, 0, 0];
    for (const x of [mid - 0.33, mid + 0.33]) {
      b.box(0.34, 0.27, 0.06, c.white_lamp, onHull(x, degrees, OUT + 0.01), { turn });
    }
    // Windows on both faces of the band too, so it reads end on.
    for (const x of [X0 + 0.02, X1 - 0.02]) {
      b.box(0.05, 0.12, 0.18, c.lamp, onHull(x, degrees + 5, 2.88), { turn, near: true });
    }
  }
  for (let k = 0; k < 6; k++) {
    const degrees = k * 60 + 15;
    b.rod(onHull(mid, degrees, 2.1), onHull(mid, degrees, 2.72), 0.14, c.dark, { sides: 8 });
  }
  b.into(group);
  const spots = [X0 + 0.12, X1 - 0.12].flatMap((x) =>
    Array.from({ length: 30 }, (_, i) => onHull(x, i * 12 + (x > mid ? 6 : 0), OUT + 0.07)),
  );
  return { group, update: chaseLamps(kit, group, spots, 0.075, c.lamp) };
}

/** Level 70: a docking arm on the front, with a cradle for the shuttle. */
export function dockingPort(tint: string, kit: Kit): Piece {
  const c = palette(tint, kit);
  const group = new THREE.Group();
  const b = builder(kit);
  const X = DOCK_AT.x;
  const along: [number, number, number] = [Math.PI / 2, 0, 0];
  b.cylinder(0.62, 0.7, 0.3, c.dark, [X, DOCK_AT.y, 2.1], { turn: along, sides: 24 });
  b.cylinder(0.4, 0.4, 1.35, c.hull, [X, DOCK_AT.y, 2.85], { turn: along, sides: 20 });
  for (const z of [2.45, 2.95, 3.45]) {
    b.add(new THREE.TorusGeometry(0.43, 0.05, 8, 28), c.paint, [X, DOCK_AT.y, z]);
  }
  b.add(new THREE.TorusGeometry(0.52, 0.065, 8, 32), c.lit, [X, DOCK_AT.y, 3.55]);
  // The cradle the shuttle sits in: a lit deck on struts.
  b.box(1.7, 0.14, 2.35, c.dark, [X, CRADLE_Y, 4.9]);
  b.box(1.45, 0.03, 2.1, c.deep, [X, CRADLE_Y + 0.08, 4.9]);
  for (const side of [-1, 1]) {
    b.box(0.06, 0.06, 2.35, c.lit, [X + side * 0.85, CRADLE_Y + 0.08, 4.9]);
    b.rod(v3(X + side * 0.6, CRADLE_Y, 4.2), v3(X + side * 0.35, -1.55, 1.5), 0.07, c.steel);
  }
  b.into(group);
  const spots = [-0.85, 0.85].flatMap((x) =>
    Array.from({ length: 6 }, (_, i) => v3(X + x, CRADLE_Y + 0.16, 3.9 + i * 0.42)),
  );
  return { group, update: chaseLamps(kit, group, spots, 0.07, c.white_lamp) };
}
const DOCK_AT = v3(-2.75, -0.55, 0);
const CRADLE_Y = -1.5;
/** How big the docked shuttle is next to the one on Opportunity Office's pad. */
const SHUTTLE_SCALE = 1.2;

/**
 * Level 80: a small satellite orbiting the module. It's thin toward and away from
 * the module (its y): that gap, between the grown parts and the flights in, is narrow.
 */
export function satellite(tint: string, kit: Kit): Piece {
  const c = palette(tint, kit);
  const group = new THREE.Group();
  const craft = new THREE.Group();
  const b = builder(kit);
  b.box(0.62, 0.5, 0.6, c.hull, [0, 0, 0]);
  b.box(0.66, 0.54, 0.16, c.paint, [0, 0, 0]);
  for (const side of [-1, 1]) {
    b.rod(v3(side * 0.31, 0, 0), v3(side * 0.55, 0, 0), 0.04, c.steel);
    b.box(0.95, 0.05, 0.66, c.solar, [side * 1.02, 0, 0], { turn: [0.35, 0, 0] });
    b.box(0.07, 0.07, 0.68, c.lit, [side * 1.52, 0, 0], { turn: [0.35, 0, 0] });
  }
  // A small dish looking ahead along its orbit.
  const bowl = new THREE.LatheGeometry(
    Array.from({ length: 6 }, (_, i) => new THREE.Vector2(i * 0.055, (i * 0.055) ** 2 * 0.9)),
    24,
  );
  const face = new THREE.LatheGeometry(
    [...(bowl.parameters.points as THREE.Vector2[])].reverse(),
    24,
  );
  b.add(face, c.white, [0, 0, 0.51], { turn: [Math.PI / 2, 0, 0] });
  b.add(bowl, c.deep, [0, 0, 0.5], { turn: [Math.PI / 2, 0, 0] });
  b.rod(v3(0, 0, 0.28), v3(0, 0, 0.74), 0.022, c.steel);
  b.ball(0.06, c.lamp, [0, 0, 0.76]);
  b.into(craft);
  const beacon = pulseLamp(kit, craft, v3(0, 0.3, -0.12), 0.09, c.white_lamp);
  group.add(craft);
  return {
    group,
    update(t) {
      const angle = satellitePose(t, craft.position);
      craft.rotation.set(angle, 0, 0); // its y stays pointing away from the module
      beacon.scale.setScalar(0.7 + 0.6 * Math.max(0, Math.sin(t * 4)));
    },
  };
}

/** Where the satellite is at time t, and its angle: a tilted orbit round the module. */
function satellitePose(t: number, out: THREE.Vector3): number {
  const a = 0.7 + t * 0.19;
  out.set(Math.sin(a) * -1.9, Math.cos(a) * 6.85, Math.sin(a) * 6.85);
  return a;
}

const HUB_X = MODULE_X.finance; // the hub, from Mission Control's centre

/** Level 100: a beacon tower on the roof that lights up the station's hub. */
export function beaconTower(tint: string, kit: Kit): Piece {
  const c = palette(tint, kit);
  const group = new THREE.Group();
  // At the hub end and set back, which keeps it out of the way of the flights in.
  const X = 4.1;
  const Z = -1.0;
  const TOP = 6.4;
  const b = builder(kit);
  b.cylinder(0.6, 0.78, 0.85, c.dark, [X, 1.85, Z], { sides: 24 });
  b.lattice(v3(X, 2.2, Z), TOP - 2.2, 0.95, 0.4, c.hull, 6);
  for (const y of [3.6, 5.1]) b.hoop(0.55, 0.045, c.lit, [X, y, Z]);
  b.cylinder(0.48, 0.34, 0.2, c.paint, [X, TOP, Z]);
  b.cylinder(0.3, 0.3, 0.5, c.glass, [X, TOP + 0.35, Z]);
  b.cylinder(0.06, 0.42, 0.28, c.paint, [X, TOP + 0.74, Z]);
  b.rod(v3(X, TOP + 0.8, Z), v3(X, TOP + 1.35, Z), 0.025, c.steel);
  b.ball(0.07, c.white_lamp, [X, TOP + 1.38, Z]);
  b.into(group);
  const lamp = pulseLamp(kit, group, v3(X, TOP + 0.35, Z), 0.24, c.white_lamp);

  // Light only from here on: it crosses in front of things, so it takes no clicks.
  const light = new THREE.Group();
  const mesh = (shape: THREE.BufferGeometry, material: THREE.Material) => {
    const m = new THREE.Mesh(kit.keep(shape), material);
    m.userData.reaches = true;
    light.add(m);
    return m;
  };
  const from = v3(X, TOP + 0.35, Z);
  const to = v3(HUB_X, 2.05, 0);
  const reach = to.clone().sub(from);
  const turn = new THREE.Quaternion().setFromUnitVectors(v3(0, 1, 0), reach.clone().normalize());
  for (const [near, far, opacity] of [
    [0.1, 0.5, 0.26],
    [0.04, 0.16, 0.5],
  ] as const) {
    const beam = mesh(
      new THREE.CylinderGeometry(far, near, reach.length(), 20, 1, true),
      c.beam(opacity),
    );
    beam.position.copy(from).lerp(to, 0.5);
    beam.quaternion.copy(turn);
  }
  // The hub, lit: a soft shell over its top and two glowing bands round it.
  const shell = mesh(
    new THREE.SphereGeometry(2.09, 40, 12, 0, Math.PI * 2, 0, Math.PI * 0.34),
    c.beam(0.2),
  );
  shell.position.set(HUB_X, 0, 0);
  for (const [radius, y] of [
    [2.2, 1.0],
    [2.55, -1.05],
  ] as const) {
    const ring = mesh(new THREE.TorusGeometry(radius, 0.07, 8, 72), c.beam(0.75));
    ring.position.set(HUB_X, y, 0);
    ring.rotation.x = Math.PI / 2;
  }
  const halos = [0, 1, 2].map(() => {
    const halo = mesh(new THREE.TorusGeometry(0.6, 0.03, 6, 48), c.beam(0.55));
    halo.position.copy(from);
    halo.rotation.x = Math.PI / 2;
    return halo;
  });
  const pulses = [0, 1, 2].map(() => mesh(new THREE.SphereGeometry(0.17, 10, 8), c.beam(0.9)));
  noClicks(light);
  group.add(light);
  return {
    group,
    update(t) {
      lamp.scale.setScalar(1 + 0.3 * Math.sin(t * 3));
      halos.forEach((halo, i) => halo.scale.setScalar(0.7 + ((t * 0.45 + i / 3) % 1) * 1.7));
      pulses.forEach((p, i) => p.position.copy(from).lerp(to, (t * 0.35 + i / 3) % 1));
    },
  };
}

// --- The Vault ----------------------------------------------------------------

/** The eight corner edges of the Vault's body, in degrees from the front toward the top. */
const EDGES = [22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5];
const GOLD_LIGHT = "#ffc24a";

/** Level 10: gold light strips down the body's edges, with lamps chasing along them. */
export function goldTrimLights(tint: string, kit: Kit): Piece {
  const c = palette(tint, kit);
  const group = new THREE.Group();
  const b = builder(kit);
  const radius = HULL.finance + 0.05;
  const strip = (degrees: number, from: number, to: number) =>
    b.rod(onHull(from, degrees, radius), onHull(to, degrees, radius), 0.055, c.lit);
  for (const degrees of EDGES) {
    // The edge above the front would cross the bar chart, so it stops either side of it.
    if (degrees !== 22.5) strip(degrees, -3.78, 3.78);
    else {
      strip(degrees, -3.78, -2.6);
      strip(degrees, 2.3, 3.78);
    }
  }
  for (const x of [-3.8, 3.8]) {
    collar(b, radius + 0.03, 0.08, c.lit, x, { sides: 8, turn: Math.PI / 8 });
  }
  b.into(group);
  const spots = [67.5, 337.5, 157.5].flatMap((degrees) =>
    Array.from({ length: 12 }, (_, i) => onHull(-3.4 + i * 0.62, degrees, radius + 0.09)),
  );
  return { group, update: chaseLamps(kit, group, spots, 0.085, c.lamp) };
}

/** Level 20: thick armour plates bolted over the body's faces. */
export function armourPlates(tint: string, kit: Kit): Piece {
  const c = palette(tint, kit);
  const apothem = HULL.finance * Math.cos(Math.PI / 8);
  return still(kit, (b) => {
    const plate = (x: number, width: number, degrees: number) => {
      const turn: [number, number, number] = [(-degrees * Math.PI) / 180, 0, 0];
      b.box(width, 1.34, 0.18, c.deep, onHull(x, degrees, apothem + 0.07), { turn });
      b.box(width - 0.24, 1.04, 0.1, c.dark, onHull(x, degrees, apothem + 0.17), { turn });
      b.box(width - 0.7, 0.1, 0.05, c.paint, onHull(x, degrees, apothem + 0.23), { turn });
      for (const sx of [-1, 1]) {
        for (const lift of [-1, 1]) {
          const at = onHull(x + sx * (width / 2 - 0.08), degrees, apothem + 0.17);
          const a = (degrees * Math.PI) / 180;
          at.add(v3(0, Math.cos(a), -Math.sin(a)).multiplyScalar(lift * 0.57));
          b.ball(0.065, c.paint, at, { near: true });
        }
      }
    };
    for (const degrees of [45, 135, 180, 225, 315, 270]) {
      for (const x of [-2.42, 0, 2.42]) plate(x, 2.05, degrees);
    }
    // The front keeps its bar chart: plates only past its ends.
    for (const x of [-3.05, 3.05]) plate(x, 1.1, 0);
  });
}

/** Level 30: a great gold-rimmed dome on top. */
export function goldDome(tint: string, kit: Kit): Piece {
  const c = palette(tint, kit);
  const gold = kit.mats.gold;
  const group = new THREE.Group();
  const b = builder(kit);
  const BASE = 3.72;
  const R = 1.62;
  const SQUASH = 0.92;
  b.cylinder(1.45, 1.62, 1.75, c.dark, [0, 2.85, 0], { sides: 8 });
  b.cylinder(1.58, 1.58, 0.2, gold, [0, BASE - 0.05, 0], { sides: 40 });
  b.add(new THREE.SphereGeometry(R, 40, 14, 0, Math.PI * 2, 0, Math.PI / 2), gold, [0, BASE, 0], {
    size: [1, SQUASH, 1],
  });
  b.hoop(R + 0.08, 0.13, gold, [0, BASE + 0.02, 0]);
  b.hoop(R + 0.17, 0.045, c.lit, [0, BASE + 0.02, 0]);
  // Gold ribs over the crown, and lit windows between them.
  for (let k = 0; k < 4; k++) {
    const rib = new THREE.TorusGeometry(R + 0.02, 0.055, 6, 32, Math.PI);
    b.add(rib, c.paint, [0, BASE, 0], {
      turn: [0, (k * Math.PI) / 4, 0],
      size: [1, SQUASH, 1],
    });
  }
  for (let k = 0; k < 16; k++) {
    const degrees = k * 22.5 + 11.25;
    const a = (degrees * Math.PI) / 180;
    const lift = 0.36;
    const out = Math.cos(lift) * (R + 0.01);
    b.box(
      0.05,
      0.3,
      0.26,
      c.white_lamp,
      [Math.cos(a) * out, BASE + Math.sin(lift) * (R + 0.01) * SQUASH, Math.sin(a) * out],
      { turn: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -a, lift, "YZX")) },
    );
  }
  const top = BASE + R * SQUASH;
  b.cylinder(0.26, 0.34, 0.22, c.paint, [0, top + 0.05, 0]);
  b.rod(v3(0, top, 0), v3(0, top + 0.5, 0), 0.04, gold);
  b.into(group);
  const finial = pulseLamp(kit, group, v3(0, top + 0.55, 0), 0.15, c.lamp);
  return {
    group,
    update(t) {
      finial.scale.setScalar(1 + 0.25 * Math.sin(t * 2.2));
    },
  };
}

const VAULT_DOCK = { x: 2.9, y: -2.65, z: 4.0 } as const;

/** Level 60: a guarded dock under the front corner, with clamps over the berth. */
export function secureDock(tint: string, kit: Kit): Piece {
  const c = palette(tint, kit);
  const gold = kit.mats.gold;
  const group = new THREE.Group();
  const b = builder(kit);
  const { x, y, z } = VAULT_DOCK;
  b.box(2.9, 0.26, 3.3, c.dark, [x, y, z]);
  b.box(2.6, 0.04, 3.0, c.deep, [x, y + 0.15, z]);
  for (const side of [-1, 1]) {
    b.box(0.1, 0.1, 3.3, gold, [x + side * 1.45, y + 0.14, z]);
    // Struts back to the hull.
    for (const reach of [2.7, 4.2]) {
      b.rod(v3(x + side * 1.0, y, reach), v3(x + side * 0.8, -1.75, 1.2), 0.09, c.steel);
    }
    // Clamp towers, each with a jaw reaching over the shuttle's side.
    for (const dz of [-1.0, 1.15]) {
      b.box(0.28, 1.5, 0.28, gold, [x + side * 1.45, y + 0.85, z + dz]);
      b.box(0.5, 0.2, 0.22, c.paint, [x + side * 1.18, y + 1.55, z + dz]);
      b.box(0.14, 0.34, 0.22, c.paint, [x + side * 0.97, y + 1.42, z + dz]);
      b.ball(0.11, c.lamp, [x + side * 1.45, y + 1.72, z + dz]);
    }
  }
  // Hazard bars across the outer end.
  for (let k = 0; k < 7; k++) {
    b.box(0.2, 0.05, 0.34, k % 2 ? c.dark : c.lit, [x - 1.2 + k * 0.4, y + 0.18, z + 1.46], {
      turn: [0, 0.5, 0],
    });
  }
  b.into(group);
  const spots = [-1.28, 1.28].flatMap((side) =>
    Array.from({ length: 7 }, (_, i) => v3(x + side, y + 0.24, z - 1.3 + i * 0.43)),
  );
  return { group, update: chaseLamps(kit, group, spots, 0.065, c.lamp) };
}

/** Level 60: the armoured cargo shuttle berthed in the dock. */
export function armouredShuttle(tint: string, kit: Kit): Piece {
  const c = palette(tint, kit);
  const gold = kit.mats.gold;
  const piece = still(kit, (b) => {
    const along: [number, number, number] = [Math.PI / 2, 0, 0];
    b.box(1.28, 0.62, 1.7, c.dark, [0, 0.52, -0.15]);
    b.box(1.04, 0.2, 1.55, c.deep, [0, 0.9, -0.18]);
    // A blunt armoured nose with a gold-framed slit window.
    b.cylinder(0.42, 0.72, 0.62, c.dark, [0, 0.5, 0.98], { turn: along, sides: 4 });
    b.box(0.66, 0.13, 0.08, c.glass, [0, 0.74, 1.12], { turn: [-0.5, 0, 0] });
    b.box(0.74, 0.05, 0.1, gold, [0, 0.84, 1.07], { turn: [-0.5, 0, 0] });
    for (const z of [-0.78, -0.12, 0.54]) b.box(1.34, 0.68, 0.13, gold, [0, 0.52, z]);
    for (const side of [-1, 1]) {
      b.box(0.16, 0.42, 1.55, c.deep, [side * 0.72, 0.5, -0.2]);
      b.box(0.05, 0.1, 1.5, c.lit, [side * 0.81, 0.52, -0.2]);
      b.cylinder(0.2, 0.25, 0.5, c.dark, [side * 0.38, 0.48, -1.22], { turn: along });
      b.cylinder(0.17, 0.17, 0.04, c.lit, [side * 0.38, 0.48, -1.49], { turn: along });
      b.box(0.14, 0.1, 1.5, c.steel, [side * 0.46, 0.1, -0.05]);
      b.ball(0.07, c.white_lamp, [side * 0.8, 0.8, 0.62]);
    }
    // Strapped cargo crates on its back.
    for (const z of [-0.66, 0.0]) {
      b.box(0.72, 0.28, 0.5, gold, [0, 1.12, z]);
      b.box(0.76, 0.3, 0.08, c.dark, [0, 1.12, z], { near: true });
    }
  });
  piece.group.position.set(VAULT_DOCK.x, VAULT_DOCK.y + 0.14, VAULT_DOCK.z);
  return piece;
}

/** Where security drone `i` is at time t: laps round the Vault, bobbing a little. */
function dronePose(i: number, t: number, out = new THREE.Vector3()): THREE.Vector3 {
  const a = (i / 4) * Math.PI * 2 + t * 0.23;
  return out.set(Math.cos(a) * 5.15, 1.45 + Math.sin(t * 1.1 + i * 1.7) * 0.18, Math.sin(a) * 5.05);
}

/** Level 80: security drones on patrol, each sweeping a scanning light. */
export function securityDrones(tint: string, kit: Kit): Piece {
  const c = palette(tint, kit);
  const group = new THREE.Group();
  const bodyGeo = kit.keep(new THREE.OctahedronGeometry(0.3, 0));
  const armGeo = kit.keep(new THREE.BoxGeometry(0.82, 0.05, 0.1));
  const podGeo = kit.keep(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 10));
  const eyeGeo = kit.keep(new THREE.SphereGeometry(0.1, 10, 8));
  const alarmGeo = kit.keep(new THREE.SphereGeometry(0.06, 8, 6));
  const scanGeo = kit.keep(new THREE.ConeGeometry(0.3, 0.75, 20, 1, true));
  const scanMat = c.beam(0.22);
  const eyeMat = c.lamp;
  const alarm = kit.glow(0xff4530, 3);
  const drones = [0, 1, 2, 3].map((i) => {
    const drone = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo, kit.mats.gold);
    body.scale.set(0.95, 0.55, 1.25);
    const arm = new THREE.Mesh(armGeo, c.dark);
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(0, 0, 0.36);
    const warn = new THREE.Mesh(alarmGeo, alarm);
    warn.position.y = 0.2;
    drone.add(body, arm, eye, warn);
    for (const x of [-0.42, 0.42]) {
      const pod = new THREE.Mesh(podGeo, c.dark);
      pod.position.x = x;
      drone.add(pod);
    }
    const sweep = new THREE.Group();
    const scan = new THREE.Mesh(scanGeo, scanMat);
    scan.position.y = -0.46;
    scan.userData.reaches = true;
    noClicks(scan);
    sweep.add(scan);
    drone.add(sweep);
    group.add(drone);
    return { drone, sweep, warn, i };
  });
  const next = new THREE.Vector3();
  return {
    group,
    update(t) {
      for (const d of drones) {
        dronePose(d.i, t, d.drone.position);
        dronePose(d.i, t + 0.1, next).sub(d.drone.position);
        d.drone.rotation.y = Math.atan2(next.x, next.z); // nose first
        d.sweep.rotation.x = Math.sin(t * 1.4 + d.i * 2.1) * 0.35;
        d.warn.scale.setScalar(0.7 + 0.6 * Math.max(0, Math.sin(t * 5 + d.i * 1.6)));
      }
    },
  };
}

const BEACON_RING = { x: 4.7, z: 6.6, y: 3.0 } as const;

/** Level 100: a gold beacon ring round the whole module. */
export function goldBeaconRing(tint: string, kit: Kit): Piece {
  const c = palette(tint, kit);
  const gold = kit.mats.gold;
  const group = new THREE.Group();
  const { x: rx, z: rz, y } = BEACON_RING;
  const at = (degrees: number, lift = 0, grow = 0) => {
    const a = (degrees * Math.PI) / 180;
    return v3(Math.cos(a) * (rx + grow), y + lift, Math.sin(a) * (rz + grow));
  };
  const loop = (radius: number, tube: number, material: THREE.Material, lift: number) => {
    const points = Array.from({ length: 72 }, (_, i) => at(i * 5, lift));
    const curve = new THREE.CatmullRomCurve3(points, true);
    b.add(new THREE.TubeGeometry(curve, 144, tube, radius, true), material);
  };
  const b = builder(kit);
  loop(10, 0.15, gold, 0);
  loop(6, 0.055, c.lit, 0.19);
  loop(6, 0.04, c.soft, -0.19);
  const posts = Array.from({ length: 8 }, (_, k) => k * 45 + 22.5);
  for (const degrees of posts) {
    b.cylinder(0.2, 0.27, 0.46, gold, at(degrees, 0.1), { sides: 8 });
    b.cylinder(0.08, 0.1, 0.4, c.dark, at(degrees, 0.5), { sides: 8 });
    b.ball(0.09, c.paint, at(degrees, -0.25), { near: true });
  }
  // Four slim struts hold it to the body's upper edges.
  for (const [degrees, sx, sz] of [
    [40, 3.5, 1],
    [140, -3.5, 1],
    [220, -3.5, -1],
    [320, 3.5, -1],
  ] as const) {
    b.rod(at(degrees), v3(sx, 1.65, sz * 1.5), 0.065, gold, { sides: 8 });
  }
  b.into(group);
  const lampGeo = kit.keep(new THREE.SphereGeometry(0.19, 12, 10));
  const shaftGeo = kit.keep(new THREE.CylinderGeometry(0.03, 0.14, 1.5, 10, 1, true));
  const shaftMat = c.beam(0.34);
  const lamps = posts.map((degrees) => {
    const lamp = new THREE.Mesh(lampGeo, kit.glow(GOLD_LIGHT, 3));
    lamp.position.copy(at(degrees, 0.76));
    const shaft = new THREE.Mesh(shaftGeo, shaftMat);
    shaft.position.copy(at(degrees, 1.5));
    shaft.userData.reaches = true;
    noClicks(shaft);
    group.add(lamp, shaft);
    return { lamp, shaft };
  });
  return {
    group,
    update(t) {
      lamps.forEach(({ lamp, shaft }, i) => {
        const wave = Math.max(0, Math.sin(t * 2.4 - (i * Math.PI) / 4));
        lamp.scale.setScalar(0.85 + 0.55 * wave);
        shaft.scale.set(1, 0.45 + 0.55 * wave, 1);
        shaft.position.y = y + 0.75 + 0.75 * shaft.scale.y;
      });
    },
  };
}

/** Where a module wants a piece that isn't drawn in its own coordinates. */
export const MODULE_PLACE: Partial<
  Record<"planner" | "finance", Partial<Record<string, (group: THREE.Group) => void>>>
> = {
  planner: {
    // The wings clear the window ring (and, at the Vault, the beacon ring).
    solarWings: (g) => g.position.set(2.0, 0, 0),
    // Berthed in the docking arm's cradle, nose to the port.
    parkedShuttle: (g) => {
      g.position.set(DOCK_AT.x, CRADLE_Y + 0.07, 4.95);
      g.rotation.set(0, Math.PI, 0);
      g.scale.setScalar(SHUTTLE_SCALE);
    },
  },
  finance: { solarWings: (g) => g.position.set(0, 0, 0) },
};

/** Module pieces that travel: they don't set how high the module's label sits. */
export const FLYING: ReadonlySet<string> = new Set(["satellite", "securityDrones"]);
