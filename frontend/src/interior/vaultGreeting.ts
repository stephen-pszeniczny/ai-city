// The Vault greeting as plain maths: for any second of it, where the robot is,
// which way it faces, where its hands are, and how far the wheel, bolts and door
// have moved. The 3D door and robot both read from here, so they always agree.
//
// Positions are in the Vault robot's "away" frame: relative to its chair (the
// room's origin, floor level), the same frame RobotAway.position uses. Yaw 0
// faces the desk (+z); -π/2 faces back down the hallway (-x).
import * as THREE from "three";

import {
  FLOOR_Y,
  HALL,
  HALL_SEAT,
  MODULE_X,
  ROBOT_HOVER,
  VAULT_DOOR,
  VAULT_GREETING as G,
} from "./stationLayout.ts";

export type GreetingPoints = {
  /** Sitting on the hallway seat. */
  seat: THREE.Vector3;
  /** Floating in front of the door, facing the wheel. */
  wheel: THREE.Vector3;
  /** Just inside the doorway. */
  doorway: THREE.Vector3;
  /** Sitting in the chair (where the greeting ends). */
  chair: THREE.Vector3;
  /** The wheel's centre, in the robot's body frame while it stands at `wheel`. */
  wheelInHands: THREE.Vector3;
};

export type GreetingFrame = {
  /** How far the wheel has turned, radians. */
  wheel: number;
  /** Locking bolts: 0 out, 1 fully drawn back. */
  bolts: number;
  /** Door: 0 closed, 1 fully open. */
  door: number;
  robot: {
    position: THREE.Vector3;
    yaw: number;
    /** Hand targets in the robot's body frame while gripping the wheel, else null. */
    hands: [THREE.Vector3, THREE.Vector3] | null;
    onChair: boolean;
  };
};

/** Total turn of the wheel while cracking it. */
const WHEEL_TURN = Math.PI * 2.5;
/** Wheel rim radius (matches the 3D wheel in VaultDoor.tsx). */
const WHEEL_RIM = 0.32;
/** How far in front of the wheel the robot floats. */
const STAND_OFF = 0.42;
/** Extra height of the hop above a straight line into the chair. */
const HOP = 0.35;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (u: number) => u * u * (3 - 2 * u);
const phase = (s: number, from: number, to: number) => clamp01((s - from) / (to - from));
const FACE_HALL = -Math.PI / 2;
const FACE_DOOR = Math.PI / 2;

export function greetingPoints(): GreetingPoints {
  // Station coordinates → the robot's frame (room origin at the module centre, floor level).
  const origin = new THREE.Vector3(MODULE_X.finance, FLOOR_Y, 0);
  const toFrame = (p: THREE.Vector3) => p.clone().sub(origin);
  const wheelFace = VAULT_DOOR.x - VAULT_DOOR.thickness / 2 - 0.08;
  const wheelCentre = new THREE.Vector3(wheelFace, VAULT_DOOR.centreY, HALL.z);
  const wheel = toFrame(new THREE.Vector3(wheelFace - STAND_OFF, FLOOR_Y, HALL.z));
  return {
    seat: toFrame(HALL_SEAT).setY(-ROBOT_HOVER),
    wheel,
    doorway: toFrame(new THREE.Vector3(VAULT_DOOR.x + 0.35, FLOOR_Y, HALL.z)),
    chair: new THREE.Vector3(0, -ROBOT_HOVER, 0),
    // Body frame while standing at `wheel` facing +x: the wheel is straight ahead (+z).
    wheelInHands: new THREE.Vector3(0, wheelCentre.y - FLOOR_Y - ROBOT_HOVER, STAND_OFF - 0.02),
  };
}

const glidePath = (pts: GreetingPoints) =>
  new THREE.CatmullRomCurve3(
    [
      pts.wheel,
      pts.wheel.clone().lerp(pts.doorway, 0.5).setY(0.03),
      pts.doorway.clone().setY(0.05),
      new THREE.Vector3(pts.chair.x - 0.7, 0.05, pts.chair.z - 0.45),
      new THREE.Vector3(pts.chair.x, 0.05, pts.chair.z - 0.3),
    ],
    false,
    "centripetal",
  );
let cachedPath: { pts: GreetingPoints; curve: THREE.CatmullRomCurve3 } | null = null;

/** The greeting at `s` seconds after it starts (negative: still waiting on the seat). */
export function greetingAt(s: number, pts: GreetingPoints): GreetingFrame {
  const crackU = phase(s, G.toWheel, G.crack);
  const wheel = WHEEL_TURN * crackU * crackU; // stiff at first, then turning freer
  const bolts = clamp01((crackU - 0.6) / 0.4);
  const door = smooth(phase(s, G.crack, G.swing));
  const frame = (
    position: THREE.Vector3,
    yaw: number,
    hands: GreetingFrame["robot"]["hands"] = null,
    onChair = false,
  ): GreetingFrame => ({ wheel, bolts, door, robot: { position, yaw, hands, onChair } });

  if (s < 0) return frame(pts.seat.clone(), FACE_HALL);
  if (s < G.rise) {
    // Rise off the seat and turn from the hallway toward the desk side.
    const u = smooth(s / G.rise);
    return frame(
      pts.seat.clone().setY(THREE.MathUtils.lerp(pts.seat.y, 0, u)),
      FACE_HALL * (1 - u),
    );
  }
  if (s < G.toWheel) {
    const u = smooth(phase(s, G.rise, G.toWheel));
    const from = pts.seat.clone().setY(0);
    return frame(from.lerp(pts.wheel, u), FACE_DOOR * u);
  }
  if (s < G.swing) {
    // At the wheel: grip the rim and turn it, then stand back a touch as the door swings.
    const back = smooth(phase(s, G.crack, G.swing)) * 0.12;
    const position = pts.wheel.clone().add(new THREE.Vector3(-back, 0, 0));
    if (s >= G.crack) return frame(position, FACE_DOOR);
    const c = pts.wheelInHands;
    // Hands on opposite sides of the rim, turning with it (body frame: x right, y up).
    const at = (a: number) =>
      new THREE.Vector3(c.x + Math.cos(a) * WHEEL_RIM, c.y + Math.sin(a) * WHEEL_RIM, c.z);
    return frame(position, FACE_DOOR, [at(Math.PI - wheel), at(-wheel)]);
  }
  if (s < G.glide) {
    if (cachedPath?.pts !== pts) cachedPath = { pts, curve: glidePath(pts) };
    const u = smooth(phase(s, G.swing, G.glide));
    const start = pts.wheel.clone().add(new THREE.Vector3(-0.12, 0, 0));
    const position = cachedPath.curve.getPointAt(u);
    if (u < 0.05) position.lerp(start, 1 - u / 0.05); // ease off the stand-back spot
    return frame(position, FACE_DOOR * (1 - u));
  }
  if (s < G.seated) {
    // Hop: up and over into the chair.
    const u = phase(s, G.glide, G.seated);
    const from = new THREE.Vector3(pts.chair.x, 0.05, pts.chair.z - 0.3);
    const position = from.lerp(pts.chair, smooth(u));
    position.y += 4 * HOP * u * (1 - u);
    return frame(position, 0);
  }
  return frame(pts.chair.clone(), 0, null, true);
}
