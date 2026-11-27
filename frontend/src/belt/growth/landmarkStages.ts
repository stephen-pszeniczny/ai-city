// The grown landmarks: stages 2 to 4 (stage 1 is in ../landmarks.ts). They stand
// on their own spot at the back of the deck, clear of the desk.
import * as THREE from "three";

import type { Kit } from "../materials.ts";
import { DISH_HEIGHT, LANDMARK_SPOT } from "./jobsPieces.ts";
import { builder, chaseLamps, palette, polar, type Builder, type Palette } from "./parts.ts";

type Model = { group: THREE.Group; update(t: number): void };
type Stage = 2 | 3 | 4;

// --- Opportunity Office: the radar dish --------------------------------------

/** A dish on a turning head: bowl, lit lip, feed arms and a glowing tip. */
function dishHead(c: Palette, kit: Kit, size: number, flagship: boolean): THREE.Group {
  const head = new THREE.Group();
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

/** A dish on its tower, from the deck (or ring) up to `height`. */
function dishTower(
  c: Palette,
  kit: Kit,
  b: Builder,
  foot: THREE.Vector3,
  height: number,
  size: number,
  flagship: boolean,
): THREE.Group {
  b.cylinder(0.55 * size + 0.15, 0.65 * size + 0.15, 0.2, c.dark, [foot.x, 0.08, foot.z], {
    sides: 24,
  });
  b.hoop(0.55 * size + 0.15, 0.05, c.lit, [foot.x, 0.19, foot.z]);
  const neck = height - 0.4 * size;
  b.lattice(
    foot.clone().setY(0.15),
    neck - 0.15,
    0.55 * size + 0.15,
    0.22 * size + 0.1,
    c.steel,
    4,
  );
  b.cylinder(0.2 * size + 0.06, 0.2 * size + 0.06, 0.12, c.paint, [foot.x, neck, foot.z]);
  const head = dishHead(c, kit, size, flagship);
  head.position.set(foot.x, height, foot.z);
  return head;
}

function radar(stage: Stage, tint: string, kit: Kit): Model {
  const c = palette(tint, kit);
  const group = new THREE.Group();
  const b = builder(kit);
  const main = dishTower(
    c,
    kit,
    b,
    LANDMARK_SPOT,
    DISH_HEIGHT[stage],
    { 2: 1.12, 3: 1.18, 4: 1.55 }[stage],
    stage === 4,
  );
  const heads = [main];
  const updates: ((t: number) => void)[] = [(t) => (main.rotation.y = t * 0.45)];
  if (stage >= 3) {
    // Two more dishes on raised towers, linked to the first by glowing cables.
    const size = stage === 4 ? 0.82 : 0.68;
    const height = stage === 4 ? 3.1 : 2.6;
    for (const [i, foot] of [polar(40, 3.7), polar(186, 3.7)].entries()) {
      const head = dishTower(c, kit, b, foot, height, size, false);
      heads.push(head);
      updates.push((t) => (head.rotation.y = -t * (0.3 + i * 0.12) + i * 2.1));
      const from = LANDMARK_SPOT.clone().setY(DISH_HEIGHT[stage] - 1.0);
      const to = foot.clone().setY(height - 0.7);
      const sag = from.clone().lerp(to, 0.5);
      sag.y -= 0.35;
      // The first cable bows out behind the screen.
      if (i === 0) sag.z += 0.9;
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

export function grownLandmark(id: "jobs" | "career", stage: Stage, tint: string, kit: Kit): Model {
  return id === "jobs" ? radar(stage, tint, kit) : hangarShip(stage, tint, kit);
}
