// The grown landmarks: stages 2 to 4 (stage 1 is in ../landmarks.ts). They stand
// clear of the desk: the radar dish out on its own platforms past the deck, the
// ship on a pad at the back of the deck.
import * as THREE from "three";

import type { Kit } from "../materials.ts";
import { DISH_HEIGHT, DISH_SPOT, LANDMARK_SPOT } from "./jobsPieces.ts";
import { builder, chaseLamps, palette, polar, type Builder, type Palette } from "./parts.ts";

/** Where a dish boom's two chords start, out from the middle and down: inside the rock. */
export const BOOM_ROOT = { upper: [3.2, -1.75], lower: [3.4, -2.45] } as const;
/** The heights the chords reach under the platform. */
const BOOM_END = { upper: -1.72, lower: -1.86 } as const;

type Model = { group: THREE.Group; update(t: number): void };
type Stage = 2 | 3 | 4;

// --- Opportunity Office: the radar dish --------------------------------------

/** A dish on a turning head: bowl, lit lip, feed arms and a glowing tip. */
function dishHead(c: Palette, kit: Kit, size: number, flagship: boolean): THREE.Group {
  const head = new THREE.Group();
  head.name = "dishHead";
  const bowlAt = new THREE.Group();
  bowlAt.rotation.x = -0.9;
  bowlAt.scale.setScalar(size);
  head.add(bowlAt);
  const b = builder(kit);
  const bowl = new THREE.LatheGeometry(
    Array.from({ length: 9 }, (_, i) => new THREE.Vector2(i * 0.19, (i * 0.19) ** 2 * 0.42)),
    40,
  );
  // Two skins, so both faces are solid without a double-sided material.
  const back = bowl.clone();
  back.setIndex(Array.from(back.index!.array).reverse()); // faces the other way
  back.computeVertexNormals();
  back.translate(0, -0.025, 0);
  b.add(bowl, c.white);
  b.add(back, c.hull);
  const lip = 1.52;
  const depth = lip ** 2 * 0.42;
  b.hoop(lip, 0.055, c.paint, [0, depth, 0]);
  b.hoop(lip * 0.62, 0.025, c.lit, [0, (lip * 0.62) ** 2 * 0.42 + 0.02, 0]);
  const focus = new THREE.Vector3(0, 1.35, 0);
  for (let k = 0; k < 3; k++)
    b.rod(polar(k * 120 + 90, lip * 0.92, depth * 0.85), focus, 0.03, c.steel);
  b.ball(flagship ? 0.2 : 0.11, c.lamp, focus);
  if (flagship) {
    b.hoop(0.36, 0.04, c.lit, [0, 1.15, 0]);
    b.hoop(lip + 0.17, 0.04, c.lit, [0, depth + 0.03, 0]);
    for (let k = 0; k < 8; k++) {
      b.rod(polar(k * 45, lip, depth), polar(k * 45, lip + 0.17, depth + 0.03), 0.025, c.steel);
      b.ball(0.07, c.lamp, polar(k * 45 + 22, lip + 0.17, depth + 0.03));
    }
  }
  b.box(0.55, 0.3, 0.55, c.dark, [0, -0.14, 0]);
  b.into(bowlAt);
  return head;
}

/**
 * A round platform out past the deck, with its top at `at`, carried by a truss boom
 * whose far ends are buried in the rock at the bearing `root` (degrees). The boom
 * comes back as its own group.
 */
function platform(
  c: Palette,
  kit: Kit,
  b: Builder,
  at: THREE.Vector3,
  wide: number,
  root: number,
): THREE.Group {
  b.cylinder(wide, wide * 0.8, 0.22, c.dark, [at.x, at.y - 0.11, at.z], { sides: 28 });
  b.hoop(wide, 0.05, c.lit, [at.x, at.y, at.z]);
  const across = polar((Math.atan2(at.z, at.x) * 180) / Math.PI + 90, 0.28);
  const truss = builder(kit);
  const BAYS = 5;
  // A short post at the boom's end lifts the platform. The boom itself runs low, under
  // the second deck's ring, and the platform stands just outside that ring.
  truss.rod(at.clone().setY(BOOM_END.upper), at.clone().setY(at.y - 0.2), 0.13, c.paint);
  for (const side of [-1, 1]) {
    const edge = across.clone().multiplyScalar(side);
    const from = [polar(root, ...BOOM_ROOT.upper), polar(root, ...BOOM_ROOT.lower)] as const;
    const to = [at.clone().setY(BOOM_END.upper), at.clone().setY(BOOM_END.lower)] as const;
    // Points along the boom's upper (0) and lower (1) chords.
    const on = (chord: 0 | 1, k: number) =>
      from[chord]
        .clone()
        .lerp(to[chord], k / BAYS)
        .add(edge);
    // In short lengths, so each can be told apart from what the deck hides.
    for (let k = 0; k < BAYS; k++) {
      truss.rod(on(0, k), on(0, k + 1), 0.07, c.steel);
      truss.rod(on(1, k), on(1, k + 1), 0.09, c.paint);
      truss.rod(on(1, k), on(0, k), 0.035, c.steel);
      truss.rod(on(1, k), on(0, k + 1), 0.03, c.steel, { near: true });
    }
  }
  const boom = new THREE.Group();
  boom.name = "boom";
  truss.into(boom);
  return boom;
}

/** A dish on its platform and tower. `height` is the head's, over the platform's top at `foot`. */
function dishTower(
  c: Palette,
  kit: Kit,
  b: Builder,
  { at: foot, root }: Footing,
  height: number,
  size: number,
  flagship: boolean,
): { head: THREE.Group; boom: THREE.Group } {
  const wide = 0.55 * size + 0.15;
  const up = (y: number) => foot.clone().setY(foot.y + y);
  const boom = platform(c, kit, b, foot, wide, root);
  b.cylinder(wide, wide + 0.1, 0.2, c.dark, up(0.08), { sides: 24 });
  b.hoop(wide, 0.05, c.lit, up(0.19));
  const neck = height - 0.4 * size;
  b.lattice(up(0.15), neck - 0.15, wide, 0.22 * size + 0.1, c.steel, 4);
  b.cylinder(0.2 * size + 0.06, 0.2 * size + 0.06, 0.12, c.paint, up(neck));
  const head = dishHead(c, kit, size, flagship);
  head.position.copy(up(height));
  return { head, boom };
}

/** A dish's platform, and the bearing its boom comes from (turned away from the desk). */
type Footing = { at: THREE.Vector3; root: number };

const MAIN_DISH: Footing = { at: DISH_SPOT, root: 68 };
/** The side dishes at stages 3 and 4: one back to the right, one far round to the left. */
const SIDE_DISHES: Footing[] = [
  { at: polar(138, 9.1, DISH_SPOT.y), root: 150 },
  { at: polar(60, 9.1, DISH_SPOT.y), root: 52 },
];

function radar(stage: Stage, tint: string, kit: Kit): Model {
  const c = palette(tint, kit);
  const group = new THREE.Group();
  const b = builder(kit);
  const main = dishTower(
    c,
    kit,
    b,
    MAIN_DISH,
    DISH_HEIGHT[stage],
    { 2: 1.12, 3: 1.18, 4: 1.34 }[stage],
    stage === 4,
  );
  const heads = [main.head];
  group.add(main.boom);
  const updates: ((t: number) => void)[] = [(t) => (main.head.rotation.y = t * 0.45)];
  if (stage >= 3) {
    // Two more dishes on raised towers, linked to the first by glowing cables.
    const size = stage === 4 ? 0.82 : 0.68;
    const height = stage === 4 ? 1.9 : 1.65;
    for (const [i, side] of SIDE_DISHES.entries()) {
      const foot = side.at;
      const { head, boom } = dishTower(c, kit, b, side, height, size, false);
      heads.push(head);
      group.add(boom);
      updates.push((t) => (head.rotation.y = -t * (0.3 + i * 0.12) + i * 2.1));
      const from = DISH_SPOT.clone().setY(DISH_SPOT.y + DISH_HEIGHT[stage] - 0.8);
      const to = foot.clone().setY(foot.y + height - 0.6);
      const sag = from.clone().lerp(to, 0.5);
      sag.y -= 0.2;
      // Bowed outward, away from the desk.
      sag.addScaledVector(sag.clone().setY(0).normalize(), 0.9);
      b.pipe([from, sag, to], 0.03, c.lit);
      const packet = new THREE.Mesh(kit.keep(new THREE.SphereGeometry(0.08, 8, 6)), c.lamp);
      group.add(packet);
      const curve = new THREE.CatmullRomCurve3([from, sag, to]);
      updates.push((t) => curve.getPoint((t * 0.4 + i * 0.5) % 1, packet.position));
    }
  }
  b.into(group);
  group.add(...heads);
  return { group, update: (t) => updates.forEach((u) => u(t)) };
}

// --- Flight School: the ship ---------------------------------------------------

/** Each stage's ship: how big, and how high it hovers. */
export const SHIP_REST = {
  2: { size: 1.35, y: 3.0 },
  3: { size: 1.8, y: 3.4 },
  4: { size: 2.15, y: 3.9 },
} as const;

/** A solid ship, nose along +z, at its stage's size. */
export function buildShip(stage: Stage, tint: string, kit: Kit): Model {
  const c = palette(tint, kit);
  const group = new THREE.Group();
  const hull = new THREE.Group();
  hull.scale.setScalar(SHIP_REST[stage].size);
  group.add(hull);
  const b = builder(kit);
  const along: [number, number, number] = [Math.PI / 2, 0, 0];
  b.cylinder(0.17, 0.23, 1.25, c.hull, [0, 0, 0], { turn: along, sides: 20 });
  b.add(new THREE.ConeGeometry(0.17, 0.55, 20), c.paint, [0, 0, 0.9], { turn: along });
  b.ball(0.13, c.glass, [0, 0.12, 0.42], { size: [0.85, 0.75, 1.7] });
  b.cylinder(0.212, 0.222, 0.13, c.paint, [0, 0, -0.22], { turn: along, sides: 20 });
  for (const s of [-1, 1]) {
    // Swept wings with lit leading edges and tip lamps.
    b.box(0.72, 0.045, 0.4, c.paint, [s * 0.47, -0.05, -0.22], { turn: [0, s * 0.42, 0] });
    b.box(0.7, 0.03, 0.045, c.lit, [s * 0.46, -0.02, -0.04], { turn: [0, s * 0.42, 0] });
    b.ball(0.045, c.lamp, [s * 0.8, -0.05, -0.38]);
  }
  b.box(0.045, 0.45, 0.34, c.paint, [0, 0.29, -0.46], { turn: [-0.35, 0, 0] });
  b.cylinder(0.2, 0.16, 0.14, c.dark, [0, 0, -0.69], { turn: along, sides: 20 });
  b.cylinder(0.13, 0.13, 0.03, c.lamp, [0, 0, -0.77], { turn: along });
  const nozzles = [new THREE.Vector3(0, 0, -0.78)];
  if (stage >= 3) {
    for (const s of [-1, 1]) {
      // Twin engine pods.
      b.cylinder(0.11, 0.14, 0.72, c.hull, [s * 0.4, -0.06, -0.42], { turn: along });
      b.add(new THREE.ConeGeometry(0.11, 0.24, 14), c.paint, [s * 0.4, -0.06, 0.06], {
        turn: along,
      });
      b.cylinder(0.1, 0.1, 0.03, c.lamp, [s * 0.4, -0.06, -0.8], { turn: along });
      b.box(0.03, 0.26, 0.24, c.paint, [s * 0.4, 0.12, -0.62], { turn: [-0.35, 0, 0] });
      nozzles.push(new THREE.Vector3(s * 0.4, -0.06, -0.8));
    }
  }
  if (stage === 4) {
    // The flagship: forward canards, a drive ring and a spine of lights.
    for (const s of [-1, 1]) {
      b.box(0.34, 0.03, 0.17, c.paint, [s * 0.3, -0.02, 0.5], { turn: [0, s * 0.5, 0] });
      b.rod(
        new THREE.Vector3(s * 0.8, -0.05, -0.55),
        new THREE.Vector3(s * 0.8, -0.05, 0.1),
        0.028,
        c.steel,
      );
      b.ball(0.04, c.lamp, [s * 0.8, -0.05, 0.12]);
    }
    b.add(new THREE.TorusGeometry(0.36, 0.035, 8, 32), c.lit, [0, 0, -0.6]);
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 + Math.PI / 4;
      b.rod(
        new THREE.Vector3(0, 0, -0.6),
        new THREE.Vector3(Math.cos(a) * 0.36, Math.sin(a) * 0.36, -0.6),
        0.018,
        c.steel,
      );
    }
    for (let k = 0; k < 4; k++)
      b.ball(0.028, c.white_lamp, [0, 0.2, 0.2 - k * 0.16], { near: true });
  }
  b.into(hull);
  const flames: THREE.Mesh[] = [];
  if (stage >= 3) {
    const geo = kit.keep(new THREE.ConeGeometry(0.1, 0.55, 12, 1, true));
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, -0.275);
    const material = c.beam(0.75);
    for (const at of nozzles) {
      const flame = new THREE.Mesh(geo, material);
      flame.position.copy(at);
      hull.add(flame);
      flames.push(flame);
    }
  }
  return {
    group,
    update(t) {
      flames.forEach((f, i) => (f.scale.z = 0.85 + 0.25 * Math.sin(t * 23 + i * 2)));
    },
  };
}

function hangarShip(stage: Stage, tint: string, kit: Kit): Model {
  const c = palette(tint, kit);
  const group = new THREE.Group();
  const spot = LANDMARK_SPOT;
  const wide = { 2: 0.95, 3: 1.25, 4: 1.5 }[stage];
  const b = builder(kit);
  b.cylinder(wide, wide + 0.15, 0.2, c.dark, [spot.x, 0.08, spot.z], { sides: 32 });
  b.hoop(wide, 0.06, c.lit, [spot.x, 0.19, spot.z]);
  b.cylinder(wide * 0.55, wide * 0.55, 0.04, c.soft, [spot.x, 0.2, spot.z], { sides: 32 });
  b.add(
    new THREE.CylinderGeometry(wide * 0.25, wide * 0.6, SHIP_REST[stage].y - 0.7, 24, 1, true),
    c.beam(0.13),
    [spot.x, (SHIP_REST[stage].y - 0.7) / 2 + 0.2, spot.z],
  );
  b.into(group);
  const lamps = Array.from({ length: 12 }, (_, k) => polar(k * 30, wide - 0.14, 0.25).add(spot));
  const chase = chaseLamps(kit, group, lamps, 0.07, c.lamp, 4);
  const ship = buildShip(stage, tint, kit);
  ship.group.name = "ship";
  ship.group.position.copy(spot).setY(SHIP_REST[stage].y);
  group.add(ship.group);
  return {
    group,
    update(t) {
      ship.group.rotation.y = t * 0.35;
      ship.group.position.y = SHIP_REST[stage].y + Math.sin(t * 1.1) * 0.12;
      ship.update(t);
      chase(t);
    },
  };
}

/** Today's dish and mast out on the platform, a little smaller so it sits in the background. */
const FIRST_DISH_SIZE = 0.86;

/**
 * Stand today's landmark (stage 1) where the grown ones stand, clear of the desk:
 * the dish on its platform past the deck, the ship on a pad that reaches down past
 * the deck's edge to the rock.
 */
export function standLandmark(
  group: THREE.Group,
  id: "jobs" | "career",
  tint: string,
  kit: Kit,
): void {
  const c = palette(tint, kit);
  const b = builder(kit);
  if (id === "jobs") {
    const dish = new THREE.Group();
    dish.scale.setScalar(FIRST_DISH_SIZE);
    dish.add(...group.children);
    group.add(dish);
    // Built in deck coordinates, then moved into the landmark's own.
    const stand = new THREE.Group();
    stand.position.copy(DISH_SPOT).negate();
    stand.add(platform(c, kit, b, DISH_SPOT, 0.62, MAIN_DISH.root));
    b.into(stand);
    group.add(stand);
    group.position.copy(DISH_SPOT);
    return;
  }
  const wide = 0.95;
  b.cylinder(wide, wide * 0.82, 0.6, c.dark, [0, -0.28, 0], { sides: 28 });
  b.hoop(wide, 0.045, c.lit, [0, 0.025, 0]);
  b.into(group);
  group.position.copy(LANDMARK_SPOT);
}

export function grownLandmark(id: "jobs" | "career", stage: Stage, tint: string, kit: Kit): Model {
  return id === "jobs" ? radar(stage, tint, kit) : hangarShip(stage, tint, kit);
}
