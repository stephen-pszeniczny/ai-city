// The upgrades inside the two control rooms. Coordinates are the room's own (see
// ControlStation): the floor under the robot, the window toward +z. The camera
// sits behind the robot and sees the far side wall (away from the hallway door)
// from about z = -0.3 to the window, so that's where new things go. The gold
// vault door is drawn on the door itself: its centre, its outer face toward -x.
import * as THREE from "three";

import { doorSide, ROOM_SIZE, VAULT_DOOR } from "../../interior/stationLayout.ts";
import { ASTEROIDS } from "../space/orbit.ts";
import type { Kit } from "../materials.ts";
import { builder, noClicks, palette, still, type Piece } from "./parts.ts";

/** The far side wall's inner face, and which way it faces into the room. */
const farWall = (room: "planner" | "finance") => {
  const side = doorSide(room);
  return { x: -side * (ROOM_SIZE.width / 2 - 0.06), out: side };
};
const ROYAL_BLUE = 0x4169e1;

/**
 * The control room's own smooth gold. (The hull's crumpled foil, right for the
 * outside, turns to speckles this close up.)
 */
const smoothGold = (kit: Kit) =>
  kit.keep(
    new THREE.MeshStandardMaterial({
      color: 0xd9a63e,
      roughness: 0.3,
      metalness: 0.9,
      // The room is dim: a faint glow of its own keeps it reading as gold, not olive.
      emissive: 0x6a4708,
      emissiveIntensity: 0.45,
    }),
  );

/** Level 50, Mission Control: more screens on the wall, their readouts moving. */
export function wallScreens(tint: string, kit: Kit): Piece {
  const c = palette(tint, kit);
  const wall = farWall("planner");
  const group = new THREE.Group();
  const face = kit.keep(new THREE.MeshBasicMaterial({ color: 0x0a1430, toneMapped: false }));
  const rim = c.glow(ROYAL_BLUE, 2.2);
  const bars = [c.glow(0x64d2ff, 1.4), c.glow(0x30d158, 1.3), c.glow(0xffb340, 1.3)];
  const barGeo = kit.keep(new THREE.BoxGeometry(0.012, 1, 0.055));
  barGeo.translate(0, 0.5, 0); // grows up from its foot
  const dotGeo = kit.keep(new THREE.SphereGeometry(0.018, 8, 6));
  const b = builder(kit);
  type Bar = { mesh: THREE.Mesh; height: number; phase: number };
  const moving: Bar[] = [];
  const dots: THREE.Mesh[] = [];
  /** One screen, w along the wall by h tall, centred at height y and depth z. */
  const screen = (x: number, y: number, z: number, w: number, h: number, n: number) => {
    const at = (depth: number, dy = 0, dz = 0) =>
      new THREE.Vector3(x + wall.out * depth, y + dy, z + dz);
    b.box(0.05, h + 0.06, w + 0.06, c.dark, at(0.025));
    b.box(0.012, h, w, face, at(0.056));
    for (const lift of [-1, 1]) b.box(0.014, 0.014, w + 0.05, rim, at(0.06, lift * (h / 2 + 0.02)));
    for (const along of [-1, 1]) {
      b.box(0.014, h + 0.05, 0.014, rim, at(0.06, 0, along * (w / 2 + 0.02)));
    }
    b.box(0.008, 0.012, w - 0.1, c.soft, at(0.064, h / 2 - 0.07));
    const bands = Math.floor((w - 0.12) / 0.085);
    for (let i = 0; i < bands; i++) {
      const mesh = new THREE.Mesh(barGeo, bars[(i + n) % bars.length]!);
      mesh.position.copy(at(0.068, -h / 2 + 0.05, -w / 2 + 0.1 + i * 0.085));
      group.add(mesh);
      moving.push({ mesh, height: h - 0.19, phase: n * 1.9 + i * 0.8 });
    }
    const dot = new THREE.Mesh(dotGeo, c.lamp);
    dot.position.copy(at(0.068, h / 2 - 0.035, w / 2 - 0.05));
    group.add(dot);
    dots.push(dot);
  };
  // A row above the room's own panels, a row below, and a tall one by the window.
  for (let i = 0; i < 3; i++) screen(wall.x, 2.37, 0.02 + i * 0.65, 0.54, 0.46, i);
  for (let i = 0; i < 3; i++) screen(wall.x, 0.55, 0.02 + i * 0.65, 0.54, 0.46, i + 3);
  screen(wall.x, 1.45, 0.65, 0.34, 1.05, 6);
  b.into(group);
  return {
    group,
    update(t) {
      for (const bar of moving) {
        const k = 0.55 + 0.42 * Math.sin(t * 1.3 + bar.phase) * Math.cos(t * 0.47 + bar.phase * 2);
        bar.mesh.scale.y = bar.height * k;
      }
      dots.forEach((d, i) => d.scale.setScalar(Math.sin(t * 2 + i) > 0 ? 1.2 : 0.6));
    },
  };
}

const TABLE_AT = { x: -1.55, z: 0.42 } as const;

/** Level 90, Mission Control: a table projecting a live-looking map of the belt. */
export function mapTable(tint: string, kit: Kit): Piece {
  const c = palette(tint, kit);
  const group = new THREE.Group();
  group.position.set(TABLE_AT.x, 0, TABLE_AT.z);
  const rim = c.glow(ROYAL_BLUE, 2.4);
  const b = builder(kit);
  b.cylinder(0.3, 0.36, 0.08, c.dark, [0, 0.04, 0], { sides: 32 });
  b.cylinder(0.12, 0.16, 0.62, c.hull, [0, 0.38, 0], { sides: 20 });
  b.cylinder(0.47, 0.4, 0.12, c.dark, [0, 0.72, 0], { sides: 40 });
  b.cylinder(0.43, 0.43, 0.012, c.glow(0x16306e, 1.4), [0, 0.787, 0], { sides: 40 });
  b.hoop(0.47, 0.018, rim, [0, 0.78, 0]);
  b.hoop(0.3, 0.006, c.soft, [0, 0.796, 0]);
  b.hoop(0.16, 0.026, rim, [0, 0.14, 0]);
  b.into(group);

  // The hologram: the station in the middle, the seven asteroids turning round it.
  const holo = new THREE.Group();
  const add = (parent: THREE.Object3D, shape: THREE.BufferGeometry, m: THREE.Material) => {
    const mesh = new THREE.Mesh(kit.keep(shape), m);
    parent.add(mesh);
    return mesh;
  };
  const cone = add(holo, new THREE.CylinderGeometry(0.46, 0.4, 0.34, 40, 1, true), c.beam(0.07));
  cone.position.y = 0.96;
  const map = new THREE.Group();
  map.position.y = 1.08;
  map.rotation.x = -0.12;
  const light = c.glow(0xbfe8ff, 2);
  add(map, new THREE.SphereGeometry(0.055, 14, 10), light);
  add(map, new THREE.BoxGeometry(0.28, 0.018, 0.018), light);
  for (const x of [-0.12, 0.12]) {
    add(map, new THREE.CapsuleGeometry(0.028, 0.05, 4, 8), light).geometry.rotateZ(Math.PI / 2);
    map.children.at(-1)!.position.x = x;
  }
  const orbit = add(map, new THREE.TorusGeometry(0.34, 0.004, 4, 64), c.beam(0.8));
  orbit.rotation.x = Math.PI / 2;
  const inner = add(map, new THREE.TorusGeometry(0.17, 0.003, 4, 48), c.beam(0.5));
  inner.rotation.x = Math.PI / 2;
  const ring = new THREE.Group();
  const rockGeo = kit.keep(new THREE.DodecahedronGeometry(0.04, 0));
  const rocks = ASTEROIDS.map((a) => {
    const angle = (a.angleDeg * Math.PI) / 180;
    const rock = new THREE.Mesh(rockGeo, c.glow(a.tint, 1.8));
    rock.position.set(Math.cos(angle) * 0.34, 0, Math.sin(angle) * 0.34);
    ring.add(rock);
    return rock;
  });
  map.add(ring);
  const sweep = add(map, new THREE.CircleGeometry(0.34, 24, 0, 0.7), c.beam(0.22));
  sweep.geometry.rotateX(-Math.PI / 2);
  holo.add(map);
  noClicks(holo);
  group.add(holo);
  return {
    group,
    update(t) {
      ring.rotation.y = -t * 0.22;
      sweep.rotation.y = t * 0.9;
      map.position.y = 1.08 + Math.sin(t * 1.1) * 0.015;
      rocks.forEach((r, i) => r.rotation.set(t * 0.5 + i, t * 0.7, 0));
    },
  };
}

/** Level 50, the Vault: more deposit boxes, each with a gold light. */
export function depositBoxes(tint: string, kit: Kit): Piece {
  const c = palette(tint, kit);
  const gold = smoothGold(kit);
  const wall = farWall("finance");
  const group = new THREE.Group();
  const steel = kit.keep(
    new THREE.MeshStandardMaterial({ color: 0x8b93a3, roughness: 0.35, metalness: 0.9 }),
  );
  const slot = c.glow(0xffc24a, 2.2);
  const blinkGeo = kit.keep(new THREE.BoxGeometry(0.012, 0.03, 0.05));
  const blinking: THREE.Mesh[] = [];
  const b = builder(kit);
  const box = (y: number, z: number, h = 0.27) => {
    const at = (depth: number, dy = 0, dz = 0) =>
      new THREE.Vector3(wall.x + wall.out * depth, y + dy, z + dz);
    b.box(0.09, h + 0.035, 0.375, gold, at(0.045));
    b.box(0.03, h - 0.02, 0.32, steel, at(0.1));
    b.box(0.014, 0.022, 0.17, slot, at(0.118, -h / 2 + 0.065));
    b.box(0.03, 0.02, 0.1, gold, at(0.125, 0.02), { near: true });
    const lamp = new THREE.Mesh(blinkGeo, c.lamp);
    lamp.position.copy(at(0.118, h / 2 - 0.06, 0.1));
    group.add(lamp);
    blinking.push(lamp);
  };
  // Rows below and above the room's own panels, and columns between them.
  for (let col = 0; col < 9; col++) {
    const z = -1.72 + col * 0.41;
    for (const y of [0.23, 0.57]) box(y, z);
    for (const y of [2.23, 2.57]) box(y, z);
  }
  for (const z of [-0.65, 0.65]) {
    for (let row = 0; row < 3; row++) box(1.12 + row * 0.34, z);
  }
  b.into(group);
  return {
    group,
    update(t) {
      blinking.forEach((l, i) => l.scale.setScalar(Math.sin(t * 1.7 + i * 2.4) > -0.4 ? 1 : 0.45));
    },
  };
}

const SHELF_AT = { x: 1.72, z: 0.5 } as const;

/** Level 70, the Vault: a gold display shelf with stacked bars and a trophy. */
export function goldShelf(tint: string, kit: Kit): Piece {
  const c = palette(tint, kit);
  const gold = smoothGold(kit);
  const bright = kit.keep(
    new THREE.MeshStandardMaterial({
      color: 0xffd36a,
      roughness: 0.22,
      metalness: 1,
      emissive: 0x6b4a08,
      emissiveIntensity: 0.55,
    }),
  );
  const group = new THREE.Group();
  group.position.set(SHELF_AT.x, 0, SHELF_AT.z);
  const b = builder(kit);
  const W = 1.05; // along the wall
  const D = 0.34;
  b.box(D, 0.16, W + 0.08, c.dark, [0, 0.08, 0]);
  for (const z of [-W / 2, W / 2]) {
    for (const x of [-D / 2, D / 2]) b.box(0.035, 1.22, 0.035, gold, [x, 0.74, z]);
  }
  const shelves = [0.28, 0.66, 1.04];
  for (const y of shelves) {
    b.box(D, 0.025, W, gold, [0, y, 0]);
    b.box(0.012, 0.012, W - 0.06, c.glow(0xffc24a, 2), [-D / 2 - 0.008, y - 0.02, 0]);
  }
  b.box(D + 0.04, 0.05, W + 0.08, gold, [0, 1.37, 0]);
  /** A gold bar: narrower at the top, lying along the shelf's depth. */
  const bar = (x: number, y: number, z: number) => {
    const shape = new THREE.CylinderGeometry(0.052, 0.072, 0.065, 4, 1);
    shape.rotateY(Math.PI / 4);
    b.add(shape, bright, [x, y + 0.033, z], { size: [2.1, 1, 1] });
  };
  for (const [y, rows] of [
    [shelves[0]!, 3],
    [shelves[1]!, 2],
  ] as const) {
    for (let level = 0; level < rows; level++) {
      const n = 5 - level;
      for (let i = 0; i < n; i++)
        bar(0, y + 0.015 + level * 0.066, (i - (n - 1) / 2) * 0.115 - 0.12);
    }
  }
  // A trophy cup on the top shelf, a gold orb and a stack of coins beside it.
  const cup = new THREE.LatheGeometry(
    [
      [0, 0],
      [0.09, 0],
      [0.03, 0.04],
      [0.025, 0.1],
      [0.1, 0.17],
      [0.12, 0.27],
    ].map(([r, y]) => new THREE.Vector2(r!, y!)),
    24,
  );
  b.add(cup, bright, [0, shelves[2]! + 0.015, 0.06]);
  for (const side of [-1, 1]) {
    b.add(
      new THREE.TorusGeometry(0.055, 0.012, 6, 20),
      bright,
      [0, shelves[2]! + 0.21, 0.06 + side * 0.13],
      { turn: [0, Math.PI / 2, 0] },
    );
  }
  b.ball(0.085, bright, [0, shelves[2]! + 0.1, -0.3]);
  b.cylinder(0.05, 0.06, 0.03, gold, [0, shelves[2]! + 0.03, -0.3]);
  for (let i = 0; i < 3; i++) {
    b.cylinder(0.055, 0.055, 0.05 + i * 0.04, bright, [0, 0.69 + i * 0.02, 0.24 + i * 0.12]);
  }
  b.into(group);
  const sparkGeo = kit.keep(new THREE.OctahedronGeometry(0.022, 0));
  const sparks = [
    [shelves[0]! + 0.24, -0.2],
    [shelves[1]! + 0.18, -0.05],
    [shelves[2]! + 0.3, 0.1],
  ].map(([y, z]) => {
    const spark = new THREE.Mesh(sparkGeo, c.glow(0xfff2c8, 2.6));
    spark.position.set(-0.13, y!, z!);
    group.add(spark);
    return spark;
  });
  return {
    group,
    update(t) {
      sparks.forEach((s, i) => s.scale.setScalar(Math.max(0, Math.sin(t * 1.8 + i * 2.1)) ** 3));
    },
  };
}

/** Level 90, the Vault: a gold finish on the round vault door. */
export function goldVaultDoor(tint: string, kit: Kit): Piece {
  const c = palette(tint, kit);
  const gold = smoothGold(kit);
  const bright = kit.keep(
    new THREE.MeshStandardMaterial({
      color: 0xffd36a,
      roughness: 0.2,
      metalness: 1,
      emissive: 0x5c3f06,
      emissiveIntensity: 0.5,
    }),
  );
  const R = VAULT_DOOR.radius;
  const face = -VAULT_DOOR.thickness / 2;
  return still(kit, (b) => {
    const across: [number, number, number] = [0, 0, Math.PI / 2];
    const hoop = (r: number, tube: number, m: THREE.Material, x: number) =>
      b.add(new THREE.TorusGeometry(r, tube, 8, 72), m, [x, 0, 0], {
        turn: [0, Math.PI / 2, 0],
      });
    // A gold face over the steel, behind the wheel.
    b.cylinder(R - 0.015, R - 0.015, 0.02, gold, [face - 0.012, 0, 0], {
      turn: across,
      sides: 72,
    });
    hoop(R - 0.04, 0.032, bright, face - 0.035);
    hoop(R * 0.68, 0.022, bright, face - 0.03);
    hoop(R * 0.34, 0.018, bright, face - 0.028);
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const from = new THREE.Vector3(face - 0.026, Math.cos(a) * 0.3, Math.sin(a) * 0.3);
      const to = new THREE.Vector3(face - 0.026, Math.cos(a) * 0.46, Math.sin(a) * 0.46);
      b.rod(from, to, k % 2 ? 0.008 : 0.016, bright);
      if (k % 2 === 0) {
        b.ball(0.027, bright, [face - 0.035, Math.cos(a) * 0.6, Math.sin(a) * 0.6]);
      }
    }
    // A lit seam just inside the rim, and a gold crest over the wheel.
    hoop(R * 0.83, 0.009, c.lit, face - 0.032);
    b.add(new THREE.OctahedronGeometry(0.06, 0), bright, [face - 0.04, 0.55, 0], {
      size: [0.5, 1.3, 1],
    });
  });
}
