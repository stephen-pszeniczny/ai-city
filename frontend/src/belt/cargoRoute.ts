// Where the level-up's cargo shuttle flies and docks. Worked out from the building
// view's camera, so it's in view at any window shape: on an asteroid just off the
// deck's edge, and at a station module outside the control room's window.
// The paths are the notification shuttle's kind (shuttlePath.ts): quadratic curves.
import * as THREE from "three";

import type { BuildingId } from "../api";
import type { ShuttlePath } from "../notifications/shuttlePath.ts";
import { roomView, ROOM_OFFSET, ROOM_SIZE, MODULE_X } from "../interior/stationLayout.ts";
import { DESK_SPOT } from "../interior/workspace.ts";
import { DECK_R } from "./growth/deck.ts";

export type Dock = {
  /** Where the shuttle holds, and what it's tethered to. */
  at: THREE.Vector3;
  edge: THREE.Vector3;
  inbound: ShuttlePath;
  outbound: ShuttlePath;
  /** The shuttle's length. */
  size: number;
  /** The way it points while docked (toward the middle of the view, and a little away). */
  heading: THREE.Vector3;
};

/**
 * Places are given on screen in view heights: (0, 0) is the middle, y goes up and
 * the top edge is 0.5. The lens is a fixed vertical angle, so these hold at every
 * window shape.
 */
function viewFrom(position: THREE.Vector3, target: THREE.Vector3, fov: number) {
  const forward = target.clone().sub(position).normalize();
  const right = forward
    .clone()
    .cross(new THREE.Vector3(0, 1, 0))
    .normalize();
  const up = right.clone().cross(forward).normalize();
  const tall = 2 * Math.tan(THREE.MathUtils.degToRad(fov) / 2);
  /** The (not unit) ray through a screen place: its length along `forward` is 1. */
  const ray = (x: number, y: number) =>
    forward
      .clone()
      .addScaledVector(right, x * tall)
      .addScaledVector(up, y * tall);
  return { position, forward, right, tall, ray };
}

/** How long the shuttle looks on screen, in view heights. */
const LENGTH = 0.2;

function dockAt(
  view: ReturnType<typeof viewFrom>,
  /** The dock's place on screen. */
  x: number,
  y: number,
  /** Depth along the view for a screen place on the dock's side. */
  depth: number,
  aspect: number,
  edge: (at: THREE.Vector3) => THREE.Vector3,
): Dock {
  const side = Math.sign(x);
  const put = (sx: number, sy: number, d: number) =>
    view.position.clone().addScaledVector(view.ray(sx, sy), d);
  const at = put(x, y, depth);
  /** Well past the window's side. */
  const off = side * (aspect / 2 + 0.3);
  return {
    at,
    edge: edge(at),
    inbound: {
      from: put(off, y + 0.2, depth * 1.15),
      via: put(x + side * 0.12, y + 0.2, depth * 1.07),
      to: at.clone(),
    },
    outbound: {
      from: at.clone(),
      via: put(x + side * 0.05, y + 0.22, depth),
      to: put(off, y + 0.5, depth * 1.15),
    },
    size: LENGTH * view.tall * depth,
    heading: view.right
      .clone()
      .multiplyScalar(-side)
      .addScaledVector(view.forward, 0.45)
      .normalize(),
  };
}

type Spot = { x: number; y: number; depth: number };

/**
 * Where an asteroid's shuttle holds: left of the robot, at a spot and depth that
 * clear everything the building grows, its biggest landmark included (see the
 * tests). Flight School's big ship fills the left, so its shuttle takes the right.
 */
const LEFT: Spot = { x: -0.55, y: 0.18, depth: 5.2 };
const SPOTS: Partial<Record<BuildingId, Spot>> = { career: { x: 0.5, y: 0.22, depth: 6 } };

/**
 * An asteroid's dock, in deck coordinates (the deck's centre, y = 0 on its top),
 * over open space just past the deck's edge.
 */
export function asteroidDock(id: BuildingId, fov: number, aspect: number, scale: number): Dock {
  const view = viewFrom(DESK_SPOT.camera, DESK_SPOT.screen, fov);
  const { x, y, depth } = SPOTS[id] ?? LEFT;
  return dockAt(view, x, y, depth, aspect, (at) =>
    new THREE.Vector3(at.x, 0, at.z).setLength(DECK_R * scale),
  );
}

/** How far outside the window the shuttle holds. */
const OFF_WINDOW = 1.7;

/** A control room's dock, in world coordinates: outside the window, beside the monitor. */
export function roomDock(id: "planner" | "finance", fov: number, aspect: number): Dock {
  const room = new THREE.Vector3(MODULE_X[id], 0, 0).add(ROOM_OFFSET);
  const rv = roomView(id);
  const view = viewFrom(rv.camera.clone().add(room), rv.screen.clone().add(room), fov);
  // The window shows to the left in Mission Control and to the right in the Vault.
  const [x, y] = [id === "planner" ? -0.39 : 0.39, 0.19];
  const wall = room.z + ROOM_SIZE.front + OFF_WINDOW;
  const depth = (wall - view.position.z) / view.ray(x, y).z;
  // Tethered to the module just outside the window's sill.
  const sill = (at: THREE.Vector3) =>
    new THREE.Vector3(at.x, room.y + 0.34, room.z + ROOM_SIZE.front + 0.15);
  return dockAt(view, x, y, depth, aspect, sill);
}
