// Flight School's own upgrade pieces, in ladder order. Deck coordinates as in
// jobsPieces.ts. They're built now and shown once Flight School is.
import * as THREE from "three";

import { DESK } from "../../interior/deskSize.ts";
import type { Kit } from "../materials.ts";
import { DECK_R } from "./deck.ts";
import type { Ground } from "./ground.ts";
import { LANDMARK_SPOT } from "./jobsPieces.ts";
import { buildShip, SHIP_REST } from "./landmarkStages.ts";
import { builder, chaseLamps, noClicks, palette, polar, still, type Piece } from "./parts.ts";
import { LOWER_WIDTH, LOWER_Y, lowerInner, REACH_DEGREES } from "./sharedPieces.ts";

const footing = (ground: Ground, at: THREE.Vector3) => Math.max(-0.9, ground.top(at.x, at.z));
const onGround = (ground: Ground, degrees: number, radius: number) => {
  const at = polar(degrees, radius);
  return at.setY(footing(ground, at));
};
const turnTo = (degrees: number): [number, number, number] => [0, (-degrees * Math.PI) / 180, 0];

/** Two rows of chasing runway lamps across the deck, and lamps round its edge. */
export function runwayLights(tint: string, kit: Kit): Piece {
  const c = palette(tint, kit);
  const group = new THREE.Group();
  const across = polar(REACH_DEGREES + 90, 0.62);
  const rows: THREE.Vector3[] = [];
  for (let k = 0; k < 7; k++) {
    for (const side of [-1, 1]) {
      rows.push(polar(REACH_DEGREES, 1.55 + k * 0.23, 0.07).addScaledVector(across, side));
    }
  }
  const b = builder(kit);
  b.box(1.45, 0.012, 0.09, c.lit, polar(REACH_DEGREES, 2.25, 0.008), {
    turn: turnTo(REACH_DEGREES),
  });
  for (let k = 0; k < 20; k++) {
    b.cylinder(0.035, 0.048, 0.07, c.white_lamp, polar(k * 18 + 5, DECK_R + 0.02, 0.05), {
      sides: 8,
    });
  }
  b.hoop(DECK_R + 0.24, 0.05, c.lit, [0, -0.2, 0]);
  rows.forEach((at) => b.cylinder(0.036, 0.046, 0.05, c.dark, [at.x, 0.03, at.z], { near: true }));
  b.into(group);
  // Chase outward: each pair across the runway lights together.
  const chase = chaseLamps(
    kit,
    group,
    rows.filter((_, i) => i % 2 === 0),
    0.036,
    c.lamp,
  );
  const chase2 = chaseLamps(
    kit,
    group,
    rows.filter((_, i) => i % 2 === 1),
    0.036,
    c.lamp,
  );
  return {
    group,
    update(t) {
      chase(t);
      chase2(t);
    },
  };
}

/** A runway reaching from the deck out past the asteroid's edge. */
export function runwayStrip(tint: string, kit: Kit, ground: Ground): Piece {
  const c = palette(tint, kit);
  const group = new THREE.Group();
  const from = DECK_R + 0.2;
  const to = 9.7;
  const turn = turnTo(REACH_DEGREES);
  const across = polar(REACH_DEGREES + 90, 0.72);
  const b = builder(kit);
  b.box(to - from, 0.16, 1.5, c.dark, polar(REACH_DEGREES, (from + to) / 2, -0.13), { turn });
  for (let r = from + 0.4; r < to - 0.6; r += 0.7) {
    b.box(0.36, 0.015, 0.1, c.white_lamp, polar(REACH_DEGREES, r, -0.04), { turn });
  }
  for (const side of [-1, 1]) {
    const edge = across.clone().multiplyScalar(side);
    b.box(to - from, 0.07, 0.07, c.lit, polar(REACH_DEGREES, (from + to) / 2, -0.06).add(edge), {
      turn,
    });
  }
  for (let k = 0; k < 4; k++) {
    b.box(
      0.5,
      0.02,
      0.16,
      c.lit,
      polar(REACH_DEGREES, to - 0.35, -0.04).addScaledVector(across, (k - 1.5) / 2),
      { turn },
    );
  }
  for (const r of [5.6, 7.4, 9.1]) {
    const hold = polar(
      REACH_DEGREES,
      ground.radius((REACH_DEGREES * Math.PI) / 180, -1.9) - 0.25,
      -1.9,
    );
    b.rod(hold, polar(REACH_DEGREES, r, -0.22), 0.08, c.steel);
  }
  b.into(group);
  const lamps: THREE.Vector3[] = [];
  for (let r = from + 0.3; r < to; r += 0.62) {
    lamps.push(polar(REACH_DEGREES, r, 0.04).addScaledVector(across, 1.06));
    lamps.push(polar(REACH_DEGREES, r, 0.04).addScaledVector(across, -1.06));
  }
  const left = chaseLamps(
    kit,
    group,
    lamps.filter((_, i) => i % 2 === 0),
    0.07,
    c.lamp,
    4,
  );
  const right = chaseLamps(
    kit,
    group,
    lamps.filter((_, i) => i % 2 === 1),
    0.07,
    c.lamp,
    4,
  );
  return {
    group,
    update(t) {
      left(t);
      right(t);
    },
  };
}

/** A barrel-roofed hangar bedded into the rock, its open door glowing. */
export function hangarDome(tint: string, kit: Kit, ground: Ground): Piece {
  const c = palette(tint, kit);
  const degrees = 168;
  const spot = onGround(ground, degrees, 5.5);
  return still(kit, (b, group) => {
    group.userData.at = spot;
    // Built along its own x (the door faces back toward the deck), then turned into place.
    const local = (x: number, y: number, z: number) =>
      new THREE.Vector3(x, y, z).applyEuler(new THREE.Euler(...turnTo(degrees))).add(spot);
    const yaw = new THREE.Quaternion().setFromEuler(new THREE.Euler(...turnTo(degrees)));
    const lie = (q: THREE.Euler) => yaw.clone().multiply(new THREE.Quaternion().setFromEuler(q));
    b.add(
      new THREE.CylinderGeometry(1.35, 1.35, 2.1, 28, 1, false, 0, Math.PI),
      c.hull,
      local(0.1, 0, 0),
      {
        turn: lie(new THREE.Euler(0, 0, Math.PI / 2)),
      },
    );
    for (const x of [-0.95, -0.25, 0.45, 1.15]) {
      b.add(new THREE.TorusGeometry(1.37, 0.07, 6, 28, Math.PI), c.paint, local(x, 0, 0), {
        turn: lie(new THREE.Euler(0, Math.PI / 2, 0)),
      });
    }
    // The open mouth: a lit half-disc with a bright arch.
    b.add(new THREE.CircleGeometry(1.05, 28, 0, Math.PI), c.lit, local(-0.97, 0.02, 0), {
      turn: lie(new THREE.Euler(0, -Math.PI / 2, 0)),
    });
    b.add(new THREE.TorusGeometry(1.1, 0.06, 6, 32, Math.PI), c.lamp, local(-0.99, 0.02, 0), {
      turn: lie(new THREE.Euler(0, Math.PI / 2, 0)),
    });
    b.box(2.6, 0.18, 2.9, c.dark, local(-0.1, -0.05, 0), { turn: yaw });
    for (const z of [-0.9, 0, 0.9]) {
      b.box(0.7, 0.03, 0.08, c.white_lamp, local(-1.35, 0.07, z), { turn: yaw, near: true });
    }
    b.ball(0.1, c.lamp, local(0.1, 1.45, 0));
  });
}

/** A tall launch tower with its service arms, and a rocket waiting on the pad. */
export function launchTower(tint: string, kit: Kit, ground: Ground): Piece {
  const c = palette(tint, kit);
  const spot = onGround(ground, 55, 4.9);
  const beside = spot.clone().add(polar(325, 0.95));
  const group = new THREE.Group();
  const b = builder(kit);
  b.box(
    2.2,
    0.22,
    1.5,
    c.dark,
    spot
      .clone()
      .lerp(beside, 0.5)
      .setY(spot.y + 0.08),
    { turn: turnTo(325) },
  );
  b.lattice(spot.clone().setY(spot.y + 0.1), 4.8, 0.85, 0.5, c.paint, 6);
  b.box(0.62, 0.14, 0.62, c.lit, [spot.x, spot.y + 4.95, spot.z]);
  b.rod(spot.clone().setY(spot.y + 5), spot.clone().setY(spot.y + 5.8), 0.03, c.steel);
  for (const y of [1.6, 3.1]) {
    b.rod(spot.clone().setY(spot.y + y), beside.clone().setY(spot.y + y), 0.06, c.steel);
  }
  // The waiting rocket.
  b.cylinder(0.3, 0.34, 2.5, c.white, [beside.x, spot.y + 1.75, beside.z]);
  b.add(new THREE.ConeGeometry(0.3, 0.75, 16), c.paint, [beside.x, spot.y + 3.37, beside.z]);
  b.cylinder(0.325, 0.325, 0.2, c.paint, [beside.x, spot.y + 2.3, beside.z]);
  b.ball(0.09, c.lamp, [beside.x, spot.y + 2.75, beside.z + 0.29]);
  for (let k = 0; k < 4; k++) {
    b.box(
      0.34,
      0.65,
      0.05,
      c.paint,
      polar(k * 90, 0.42, spot.y + 0.75).add(beside.clone().setY(0)),
      { turn: turnTo(k * 90) },
    );
  }
  b.cylinder(0.2, 0.28, 0.3, c.dark, [beside.x, spot.y + 0.36, beside.z]);
  b.into(group);
  const beacon = new THREE.Mesh(kit.keep(new THREE.SphereGeometry(0.13, 10, 8)), c.lamp);
  beacon.position.set(spot.x, spot.y + 5.85, spot.z);
  const steam = new THREE.Mesh(kit.keep(new THREE.TorusGeometry(0.4, 0.07, 6, 24)), c.beam(0.25));
  steam.rotation.x = Math.PI / 2;
  group.add(beacon, steam);
  return {
    group,
    update(t) {
      beacon.scale.setScalar(0.7 + 0.6 * Math.max(0, Math.sin(t * 3.5)));
      const k = (t * 0.35) % 1;
      steam.position.set(beside.x, spot.y + 0.25 + k * 0.15, beside.z);
      steam.scale.setScalar(0.8 + k * 1.2);
    },
  };
}

/**
 * The second toy rocket, on the desk. Workspace coordinates (not deck): it's put
 * with the desk, so it keeps its size while the asteroid grows.
 */
export function deskRocket(tint: string, kit: Kit): Piece {
  const c = palette(tint, kit);
  const piece = still(kit, (b) => {
    b.cylinder(0.075, 0.085, 0.02, c.dark, [0, 0.01, 0]);
    b.hoop(0.066, 0.005, c.lit, [0, 0.022, 0]);
    b.cylinder(0.034, 0.038, 0.17, c.paint, [0, 0.14, 0]);
    b.add(new THREE.ConeGeometry(0.034, 0.075, 16), c.white, [0, 0.262, 0]);
    b.cylinder(0.036, 0.036, 0.022, c.white, [0, 0.185, 0]);
    b.ball(0.012, c.lamp, [0, 0.14, -0.037]);
    for (let k = 0; k < 3; k++) {
      const degrees = k * 120 + 30;
      b.box(0.045, 0.065, 0.006, c.white, polar(degrees, 0.05, 0.07), { turn: turnTo(degrees) });
    }
  });
  // Between the robot's water glass and the plant.
  piece.group.position.set(0.69, DESK.topY, 0.74);
  return piece;
}

/** A fuel farm: banded tanks on legs, joined by pipes. */
export function fuelFarm(tint: string, kit: Kit, ground: Ground): Piece {
  const c = palette(tint, kit);
  return still(kit, (b) => {
    const tops: THREE.Vector3[] = [];
    for (const [degrees, radius, size] of [
      [201, 5.1, 0.75],
      [219, 5.35, 0.62],
      [187, 4.75, 0.5],
    ] as const) {
      const foot = onGround(ground, degrees, radius);
      const centre = foot.clone().setY(foot.y + size + 0.3);
      b.add(new THREE.SphereGeometry(size, 24, 16), c.white, centre);
      b.hoop(size + 0.01, 0.07, c.paint, centre);
      b.hoop(size * 0.86, 0.035, c.lit, centre.clone().setY(centre.y + size * 0.52));
      for (let k = 0; k < 4; k++) {
        const out = polar(k * 90 + 45, size * 0.75);
        b.rod(
          foot
            .clone()
            .add(out)
            .setY(foot.y - 0.1),
          centre
            .clone()
            .add(out)
            .setY(centre.y - size * 0.4),
          0.05,
          c.steel,
        );
      }
      b.ball(0.08, c.lamp, centre.clone().setY(centre.y + size + 0.08));
      tops.push(centre);
    }
    for (const x of [0, 1]) {
      const spot = onGround(ground, 232 + x * 13, 4.85);
      b.cylinder(0.3, 0.3, 1.5, c.hull, [spot.x, spot.y + 0.75, spot.z]);
      b.add(new THREE.SphereGeometry(0.3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), c.paint, [
        spot.x,
        spot.y + 1.5,
        spot.z,
      ]);
      b.hoop(0.31, 0.04, c.lit, [spot.x, spot.y + 1.15, spot.z]);
      tops.push(spot.clone().setY(spot.y + 0.9));
    }
    b.pipe([tops[2]!, tops[0]!, tops[1]!, tops[3]!, tops[4]!], 0.07, c.paint);
    b.pipe([tops[0]!, polar(204, 4.0, 0.05), polar(204, 3.1, 0.05)], 0.06, c.steel);
  });
}

/** A gantry crane whose arm swings over the launch side, carrying a module. */
export function gantryArm(tint: string, kit: Kit, ground: Ground): Piece {
  const c = palette(tint, kit);
  const spot = onGround(ground, 78, 5.35);
  const group = new THREE.Group();
  const b = builder(kit);
  b.box(1.1, 0.2, 1.1, c.dark, [spot.x, spot.y + 0.08, spot.z]);
  b.lattice(spot.clone().setY(spot.y + 0.15), 3.9, 0.8, 0.55, c.steel, 5);
  b.into(group);
  const top = new THREE.Group();
  top.position.set(spot.x, spot.y + 4.15, spot.z);
  const a = builder(kit);
  a.box(0.75, 0.45, 0.7, c.paint, [0, 0, 0]);
  a.box(0.8, 0.07, 0.75, c.lit, [0, -0.25, 0]);
  a.box(2.9, 0.2, 0.3, c.paint, [1.65, 0.18, 0]);
  a.box(1.0, 0.2, 0.3, c.paint, [-0.75, 0.18, 0]);
  a.box(0.55, 0.5, 0.55, c.dark, [-1.25, 0.1, 0]);
  a.rod(new THREE.Vector3(0, 0.95, 0), new THREE.Vector3(3.0, 0.28, 0), 0.025, c.steel);
  a.rod(new THREE.Vector3(0, 0.95, 0), new THREE.Vector3(-1.2, 0.28, 0), 0.025, c.steel);
  a.rod(new THREE.Vector3(0, 0.2, 0), new THREE.Vector3(0, 0.95, 0), 0.05, c.steel);
  a.rod(new THREE.Vector3(2.7, 0.1, 0), new THREE.Vector3(2.7, -0.85, 0), 0.018, c.dark);
  a.cylinder(0.28, 0.28, 0.65, c.white, [2.7, -1.1, 0], { turn: [0, 0, Math.PI / 2] });
  a.cylinder(0.29, 0.29, 0.14, c.paint, [2.7, -1.1, 0], { turn: [0, 0, Math.PI / 2] });
  a.ball(0.1, c.lamp, [3.15, 0.2, 0]);
  a.into(top);
  group.add(top);
  return {
    group,
    update(t) {
      // Swings between the runway side and the back, never round toward the camera.
      top.rotation.y = -1.2 + Math.sin(t * 0.2) * 1.0;
    },
  };
}

/** A control tower rising from the lower deck: a glass cab with a turning radar. */
export function controlTower(tint: string, kit: Kit, ground: Ground): Piece {
  const c = palette(tint, kit);
  const spot = polar(122, lowerInner(ground) + LOWER_WIDTH / 2, LOWER_Y);
  const cab = LOWER_Y + 5.2;
  const group = new THREE.Group();
  const b = builder(kit);
  b.cylinder(0.55, 0.65, 0.25, c.dark, [spot.x, LOWER_Y + 0.12, spot.z]);
  b.cylinder(0.26, 0.38, cab - LOWER_Y, c.hull, [spot.x, (cab + LOWER_Y) / 2, spot.z]);
  for (let y = LOWER_Y + 1; y < cab - 0.6; y += 0.8) {
    b.cylinder(0.37, 0.37, 0.08, c.lit, [spot.x, y, spot.z]);
  }
  b.cylinder(0.85, 0.5, 0.35, c.paint, [spot.x, cab + 0.1, spot.z], { sides: 12 });
  b.cylinder(0.92, 0.8, 0.55, c.white_lamp, [spot.x, cab + 0.55, spot.z], { sides: 12 });
  b.cylinder(0.97, 0.97, 0.12, c.paint, [spot.x, cab + 0.9, spot.z], { sides: 12 });
  for (let k = 0; k < 12; k++) {
    const at = polar(k * 30, 0.9, cab + 0.55).add(spot.clone().setY(0));
    b.box(0.04, 0.58, 0.07, c.dark, at, { turn: turnTo(k * 30), near: true });
  }
  b.rod(spot.clone().setY(cab + 0.9), spot.clone().setY(cab + 1.5), 0.05, c.steel);
  b.into(group);
  const radar = new THREE.Group();
  radar.position.set(spot.x, cab + 1.55, spot.z);
  const r = builder(kit);
  r.box(1.4, 0.22, 0.1, c.hull, [0, 0, 0]);
  r.box(1.42, 0.05, 0.12, c.lit, [0, 0.13, 0]);
  r.into(radar);
  group.add(radar);
  return {
    group,
    update(t) {
      radar.rotation.y = t * 1.3;
    },
  };
}

/** Seconds between launches, when the first one leaves, and how long a flight lasts. */
const LAUNCH = { period: 60, first: 8, flight: 22, climb: 5 } as const;

/** Now and then the flagship lifts off, laps the whole belt and settles back. */
export function shipLaunch(tint: string, kit: Kit): Piece {
  const group = new THREE.Group();
  const flyer = new THREE.Group();
  const ship = buildShip(4, tint, kit);
  flyer.add(ship.group);
  const c = palette(tint, kit);
  const trailGeo = kit.keep(new THREE.ConeGeometry(0.35, 3.4, 14, 1, true));
  const trail = new THREE.Mesh(trailGeo, c.beam(0.5));
  trail.rotation.x = -Math.PI / 2;
  trail.position.z = -3.4;
  flyer.add(trail);
  flyer.visible = false;
  flyer.traverse((o) => (o.userData.reaches = true));
  noClicks(flyer);
  group.add(flyer);

  const rest = LANDMARK_SPOT.clone().setY(SHIP_REST[4].y);
  const high = rest.clone().setY(rest.y + 6);
  const local = new THREE.Vector3();
  const world = new THREE.Vector3();
  /** Where the ship is `s` seconds into a flight, in the parent's coordinates. */
  const at = (s: number, out: THREE.Vector3) => {
    const climb = (k: number) => out.copy(rest).lerp(high, k * k * (3 - 2 * k));
    if (s < LAUNCH.climb) return climb(s / LAUNCH.climb);
    if (s > LAUNCH.flight - LAUNCH.climb) return climb((LAUNCH.flight - s) / LAUNCH.climb);
    // Round the ring: starts and ends above the asteroid, wherever it has got to.
    const u = (s - LAUNCH.climb) / (LAUNCH.flight - LAUNCH.climb * 2);
    const eased = u * u * (3 - 2 * u);
    world.copy(high);
    group.parent?.localToWorld(world);
    const radius = Math.hypot(world.x, world.z);
    const angle = Math.atan2(world.z, world.x) + eased * Math.PI * 2;
    out.set(
      Math.cos(angle) * radius,
      world.y + Math.sin(Math.PI * u) * 4,
      Math.sin(angle) * radius,
    );
    return group.parent ? group.parent.worldToLocal(out) : out;
  };
  const forward = new THREE.Vector3(0, 0, 1);
  let away = false;
  return {
    group,
    away: () => away,
    update(t) {
      const s = (t % LAUNCH.period) - LAUNCH.first;
      away = s >= 0 && s <= LAUNCH.flight;
      flyer.visible = away;
      if (!away) return;
      group.parent?.updateWorldMatrix(true, false);
      at(s, flyer.position);
      const cruising = s > LAUNCH.climb && s < LAUNCH.flight - LAUNCH.climb;
      trail.visible = cruising;
      if (cruising) {
        at(s + 0.08, local).sub(flyer.position);
        if (local.lengthSq() > 1e-8)
          flyer.quaternion.setFromUnitVectors(forward, local.normalize());
      } else {
        flyer.quaternion.identity();
      }
      ship.update(t);
    },
  };
}
