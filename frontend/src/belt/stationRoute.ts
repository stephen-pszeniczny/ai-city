// Camera routes through the space station: belt → control room, control room →
// belt, and Mission Control ↔ the Vault. Each route is one smooth curve flown at
// a steady pace with a single ease in and ease out (no stop-and-go between
// steps). The camera looks a little ahead along the curve, so it can never face
// backwards or spin, and blends from where it started looking to where it ends
// up looking. The only stop is at the vault door on the first visit of a
// session, while the robot opens it. Pure maths, so it's tested.
import * as THREE from "three";

import type { Pose } from "./flightPath.ts";
import { LOOK } from "./look.ts";
import {
  doorSide,
  HALL,
  HATCH,
  MODULE_X,
  ROOM_OFFSET,
  ROOM_SIZE,
  roomView,
  VAULT_DOOR,
  VAULT_GREETING,
} from "../interior/stationLayout.ts";

export type StationRoom = "planner" | "finance";

export type Route = {
  /** Seconds from start to finish, including any hold at the door. */
  duration: number;
  /** Where the camera is `t` seconds in (clamped to the route's ends). */
  sample(t: number): Pose;
  /** The first-visit stop at the vault door: when the camera gets there and how long it waits. */
  doorStop: { at: number; hold: number } | null;
};

const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (u: number) => u * u * (3 - 2 * u);
const smoothstep = (a: number, b: number, x: number) => smooth(clamp01((x - a) / (b - a)));

/** Camera height inside the station. */
const EYE = HATCH.centreY + 0.25;
/** The station's outline (hub, hallways, rooms), for telling inside from outside. */
const HULL = new THREE.Box3(
  v(MODULE_X.planner - ROOM_SIZE.width / 2, -2, ROOM_SIZE.back - 0.2),
  v(MODULE_X.finance + ROOM_SIZE.width / 2, 2.5, HATCH.z),
);
/** What the camera keeps centred while out in space: the hatch it's heading for. */
const HATCH_POINT = v(0, EYE, HATCH.z);
/** Where the outside speed blends into the inside speed (distance from the hull). */
const BLEND = { from: 0.5, to: 40 } as const;
/** How fast the camera may turn while blending its start direction (radians per second). */
const START_TURN_RATE = 0.8;
/** Share of a flight's progress the camera's heading is averaged over (each side), to stop sway. */
const HEADING_SMOOTHING = 0.07;
/** By this distance from the station, the approach has lined up with the hatch side. */
const LINED_UP_AT = 22;
/** Extra seconds for an approach that has to swing all the way round (half that for 90°). */
const EXTRA_FOR_FULL_SWING = 0.75;

/** How far round the station (radians, 0..π) a view at `p` is from the hatch side. */
function swingFrom(p: THREE.Vector3): number {
  if (Math.hypot(p.x, p.z) <= LINED_UP_AT) return 0;
  return Math.abs(Math.atan2(p.x, p.z));
}
/** A flight's seconds, a little longer when the approach swings round the station. */
const withSwing = (seconds: number, p: THREE.Vector3) =>
  seconds + (EXTRA_FOR_FULL_SWING * swingFrom(p)) / Math.PI;

/** The room view: behind the robot, looking at its screen (station coordinates). */
export function roomPose(room: StationRoom): Pose {
  const centre = v(MODULE_X[room], 0, 0).add(ROOM_OFFSET);
  const rv = roomView(room);
  return { position: centre.clone().add(rv.camera), target: centre.clone().add(rv.screen) };
}

/** -1 toward Mission Control, +1 toward the Vault. */
const towards = (room: StationRoom) => (room === "planner" ? -1 : 1);

/** Station path points from the hatch to a room's camera spot (hub turn, hallway, doorway). */
function hatchToRoom(room: StationRoom, opts: { stopAtDoor: boolean }) {
  const s = towards(room);
  const roomSide = doorSide(room); // which way the hallway door is from the room's centre
  const intoRoom = v(MODULE_X[room] + roomSide * (ROOM_SIZE.width / 2 - 0.6), EYE + 0.6, -1.0);
  // Far enough back to see the robot, its seat and the whole door.
  const stop = v(VAULT_DOOR.x - 3.4, EYE + 0.3, HALL.z + 0.35);
  const toHallway = [
    v(0, EYE, HATCH.z + 0.6), // just inside the hatch
    v(s * 0.9, EYE + 0.05, 1.5), // rounding the hub's corner
    v(s * 2.0, EYE + 0.1, 0.35),
    v(s * (HALL.startX + 0.6), EYE + 0.12, HALL.z), // into the hallway
  ];
  const toRoom = [
    v(s * (HALL.endX - 0.8), EYE + 0.2, HALL.z), // hallway end
    intoRoom,
    roomPose(room).position,
  ];
  return { toHallway, stop: opts.stopAtDoor ? stop : null, toRoom };
}

/** Room camera spot → through its hallway to the hub (Mission Control or Vault side). */
function roomToHub(room: StationRoom) {
  const { toHallway, toRoom } = hatchToRoom(room, { stopAtDoor: false });
  // Leave out the room spot itself and the points by the hatch (the route decides those).
  return [...toRoom.slice(0, -1).reverse(), toHallway[3]!];
}

/** Yaw and pitch of a direction, and back (the camera never rolls). */
const toAngles = (d: THREE.Vector3) => ({
  yaw: Math.atan2(d.x, d.z),
  pitch: Math.asin(THREE.MathUtils.clamp(d.y, -1, 1)),
});
const fromAngles = (yaw: number, pitch: number, out = new THREE.Vector3()) =>
  out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
/** Signed yaw turn from a to b, the short way round. */
function yawTurn(a: THREE.Vector3, b: THREE.Vector3) {
  const dy = toAngles(b).yaw - toAngles(a).yaw;
  return Math.atan2(Math.sin(dy), Math.cos(dy));
}
/**
 * Blend direction a toward b by k. `sign` fixes which way round a big turn goes
 * (+1 or -1), so a turn of nearly 180° can't flip sides from one frame to the next.
 */
function blendDir(a: THREE.Vector3, b: THREE.Vector3, k: number, sign: number) {
  const A = toAngles(a);
  const B = toAngles(b);
  let dy = yawTurn(a, b);
  if (Math.abs(dy) > Math.PI / 2 && Math.sign(dy) !== sign) dy += sign * 2 * Math.PI;
  return fromAngles(A.yaw + dy * k, A.pitch + (B.pitch - A.pitch) * k);
}
const dirOf = (p: Pose) => p.target.clone().sub(p.position).normalize();

type Leg = { duration: number; weighted: number; sample(t: number): Pose };

/**
 * One smooth leg through `points` (the first is the start pose's position, the
 * last the end pose's), taking `duration` seconds with one ease in and out.
 */
function makeLeg(
  points: THREE.Vector3[],
  start: Pose,
  end: Pose,
  duration: number,
  endBlendAt: number | THREE.Vector3,
): Leg {
  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
  // Tables of distance and weighted distance (outside counts less, so it's flown faster).
  const N = 4000; // fine enough that speed never jitters where short and long segments meet
  const samples: THREE.Vector3[] = [points[0]!.clone()];
  const len: number[] = [0];
  const wsum: number[] = [0];
  let prev = curve.getPoint(0);
  for (let i = 1; i <= N; i++) {
    const p = curve.getPoint(i / N);
    const d = p.distanceTo(prev);
    const mid = p.clone().add(prev).multiplyScalar(0.5);
    const outside = smoothstep(BLEND.from, BLEND.to, HULL.distanceToPoint(mid));
    // Blend the speed (1 / weight) evenly, so the slow-down is gradual all the way in.
    const w = 1 / THREE.MathUtils.lerp(1, 1 / LOOK.flights.outsideWeight, outside);
    samples.push(p);
    len.push(len[i - 1]! + d);
    wsum.push(wsum[i - 1]! + d * w);
    prev = p;
  }
  const total = len[N]!;
  const weighted = wsum[N]!;
  /** Curve parameter where a table reaches `value`. */
  const lookup = (table: number[], value: number) => {
    if (value <= 0) return 0;
    if (value >= table[N]!) return 1;
    let lo = 0;
    let hi = N;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (table[m]! < value) lo = m;
      else hi = m;
    }
    const f = (value - table[lo]!) / (table[hi]! - table[lo]! || 1);
    return (lo + f) / N;
  };
  // The end blend (turning to the final view) starts at a given fraction of the
  // leg, or when the camera passes a given point (e.g. through a room's doorway).
  let endBlend = typeof endBlendAt === "number" ? endBlendAt : 0.3;
  if (typeof endBlendAt !== "number") {
    let best = 0;
    samples.forEach((p, i) => {
      if (p.distanceToSquared(endBlendAt) < samples[best]!.distanceToSquared(endBlendAt)) best = i;
    });
    const f = wsum[best]! / weighted;
    let lo = 0;
    let hi = 1;
    for (let n = 0; n < 40; n++) {
      const m = (lo + hi) / 2;
      if (smooth(m) < f) lo = m;
      else hi = m;
    }
    endBlend = Math.min(0.75, Math.max(0.35, 1 - lo));
  }
  const startDir = dirOf(start);
  const endDir = dirOf(end);
  const startDist = start.position.distanceTo(start.target);
  const endDist = end.position.distanceTo(end.target);
  // Turning from where it was looking: longer for a big turn, so it never whips round.
  const firstAhead = curve
    .getPoint(lookup(len, Math.min(total, LOOK.flights.lookAhead)))
    .sub(points[0]!);
  const startTurn = firstAhead.lengthSq() > 1e-9 ? startDir.angleTo(firstAhead.normalize()) : 0;
  const startBlend = Math.min(0.5, Math.max(0.2, startTurn / (START_TURN_RATE * duration)));

  // The way the camera faces along the route: the direction a little ahead, then
  // averaged over a short stretch of flying time, so small bends (round the hub,
  // into a narrow hallway) never swing it side to side, and the faster outside
  // stretch can't whip it round. A table by flight progress, worked out once.
  const H = 800;
  const heading: THREE.Vector3[] = [];
  for (let i = 0; i <= H; i++) {
    const along = len[Math.round(lookup(wsum, (i / H) * weighted) * N)]!;
    const here = curve.getPoint(lookup(len, along));
    const ahead = curve.getPoint(lookup(len, Math.min(total, along + LOOK.flights.lookAhead)));
    const d = ahead.sub(here);
    const along_ =
      d.lengthSq() > 1e-9 ? d.normalize() : (heading[i - 1]?.clone() ?? endDir.clone());
    // Out in space, keep the station's hatch centred (a film-style dolly round it);
    // nearing the hatch, face along the route instead.
    const out = smoothstep(BLEND.from, BLEND.to, HULL.distanceToPoint(here));
    const toHatch = HATCH_POINT.clone().sub(here).normalize();
    heading.push(along_.lerp(toHatch, out).normalize());
  }
  const reach = Math.max(1, Math.round(HEADING_SMOOTHING * H));
  for (let pass = 0; pass < 3; pass++) {
    const copy = heading.map((h) => h.clone());
    for (let i = 0; i <= H; i++) {
      const sum = new THREE.Vector3();
      for (let j = Math.max(0, i - reach); j <= Math.min(H, i + reach); j++) sum.add(copy[j]!);
      if (sum.lengthSq() > 1e-9) heading[i]!.copy(sum.normalize());
    }
  }
  /** Heading at a share of the flight (0..1 of the weighted distance). */
  const headingAt = (share: number) => {
    const x = Math.min(1, Math.max(0, share)) * H;
    const i = Math.min(H - 1, Math.floor(x));
    return heading[i]!.clone()
      .lerp(heading[i + 1]!, x - i)
      .normalize();
  };

  /** Where the camera is, and the way it faces along the route, at progress k (0..1). */
  const forwardAt = (k: number) => {
    const u = lookup(wsum, smooth(k) * weighted);
    return { position: curve.getPoint(u), forward: headingAt(smooth(k)) };
  };
  // Which way round each blend turns, decided once (see blendDir).
  const sideOf = (dy: number) => (dy >= 0 ? 1 : -1);
  const startSign = sideOf(yawTurn(startDir, forwardAt(startBlend).forward));
  const endSign = sideOf(yawTurn(forwardAt(1 - endBlend).forward, endDir));

  return {
    duration,
    weighted,
    sample(t: number): Pose {
      const k = clamp01(t / duration);
      if (k <= 0) return { position: start.position.clone(), target: start.target.clone() };
      if (k >= 1) return { position: end.position.clone(), target: end.target.clone() };
      const { position, forward } = forwardAt(k);
      let dir = forward;
      if (k < startBlend) dir = blendDir(startDir, forward, smooth(k / startBlend), startSign);
      if (k > 1 - endBlend)
        dir = blendDir(dir, endDir, smooth((k - (1 - endBlend)) / endBlend), endSign);
      const dist = THREE.MathUtils.lerp(startDist, endDist, k);
      return { position, target: position.clone().addScaledVector(dir.normalize(), dist) };
    },
  };
}

/** A route of one leg, or two legs with a still hold between them. */
function route(legs: [Leg] | [Leg, Leg], hold: number): Route {
  const [a, b] = legs;
  if (!b) return { duration: a.duration, sample: (t) => a.sample(t), doorStop: null };
  return {
    duration: a.duration + hold + b.duration,
    doorStop: { at: a.duration, hold },
    sample(t) {
      if (t < a.duration) return a.sample(t);
      if (t < a.duration + hold) return a.sample(a.duration);
      return b.sample(t - a.duration - hold);
    },
  };
}

/** True when a point is inside (or right by) the station. */
const inside = (p: THREE.Vector3) => HULL.distanceToPoint(p) < 0.5;

/** Drop the route points already behind a start that's partway along it. */
function fromPartway(start: THREE.Vector3, points: THREE.Vector3[]): THREE.Vector3[] {
  if (!inside(start) || points.length < 2) return points;
  let best = 0;
  let bestD = Infinity;
  const seg = new THREE.Line3();
  const closest = new THREE.Vector3();
  for (let i = 0; i < points.length - 1; i++) {
    seg.set(points[i]!, points[i + 1]!);
    seg.closestPointToPoint(start, true, closest);
    const d = closest.distanceTo(start);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return points.slice(best + 1);
}

/**
 * Outside the hatch: off to the side of the hatch line (away from the room), so
 * the camera crosses the plane of the station's big outer ring (radius 6.6,
 * round the hub in the x = 0 plane) inside the ring, not through its tube, and
 * the turn through the hub is one smooth curve. Returns [further out, nearer the hatch].
 */
const outsideHatch = (room: StationRoom) => {
  const off = -towards(room);
  return [v(off * 3.0, EYE + 0.9, 8.6), v(off * 1.1, EYE + 0.25, 5.2)] as const;
};

/**
 * The approach from a belt view at `p` to the hatch: one wide, gradual arc that
 * lines up with the hatch side while closing in (finished by LINED_UP_AT), so the
 * camera never circles the station once it's there. Ends with the two points just
 * outside the hatch. Flying out uses the same points in reverse.
 */
function approachFrom(p: THREE.Vector3, room: StationRoom): THREE.Vector3[] {
  const [far, near] = outsideHatch(room);
  const r0 = Math.hypot(p.x, p.z);
  if (r0 <= LINED_UP_AT) return [far, near];
  const yaw0 = Math.atan2(p.x, p.z); // 0 = straight out from the hatch
  let turn = Math.atan2(far.x, far.z) - yaw0;
  turn = Math.atan2(Math.sin(turn), Math.cos(turn));
  // Straight behind: go round the Vault end, as before.
  if (Math.abs(Math.abs(turn) - Math.PI) < 0.05) turn = Math.abs(turn);
  const steps = Math.max(1, Math.ceil(Math.abs(turn) / 0.45)); // a point every ~25°
  const arc: THREE.Vector3[] = [];
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    // Evenly, finished by 70% of the way in, so the last stretch already heads for the hatch.
    const yaw = yaw0 + turn * Math.min(1, f / 1.0);
    const r = THREE.MathUtils.lerp(r0, LINED_UP_AT, f);
    const y = THREE.MathUtils.lerp(p.y, EYE + 4, f); // stays above the asteroid ring until close
    arc.push(v(Math.sin(yaw) * r, y, Math.cos(yaw) * r));
  }
  return [...arc, far, near];
}

/** Into a control room from outside (the belt view). */
export function routeIn(room: StationRoom, from: Pose, opts: { stopAtDoor: boolean }): Route {
  const stopAtDoor = opts.stopAtDoor && room === "finance";
  const path = hatchToRoom(room, { stopAtDoor });
  const approach = inside(from.position) ? [] : approachFrom(from.position, room);
  const first = fromPartway(from.position, [...approach, ...path.toHallway]);
  const end = roomPose(room);
  if (!path.stop) {
    const pts = [from.position.clone(), ...first, ...path.toRoom];
    const seconds = withSwing(LOOK.flights.toStationSeconds, from.position);
    return route([makeLeg(pts, from, end, seconds, path.toRoom[0]!)], 0);
  }
  return doorRoute(
    from,
    [from.position.clone(), ...first],
    path.stop,
    path.toRoom,
    end,
    withSwing(LOOK.flights.toStationSeconds, from.position),
  );
}

/** Two legs: to the stop by the vault door, wait while it opens, then on into the room. */
function doorRoute(
  from: Pose,
  toStop: THREE.Vector3[],
  stop: THREE.Vector3,
  toRoom: THREE.Vector3[],
  end: Pose,
  seconds: number,
): Route {
  const atDoor: Pose = {
    position: stop.clone(),
    target: v(VAULT_DOOR.x, VAULT_DOOR.centreY, HALL.z),
  };
  // The first leg gets the route's usual time, shared by how far each leg goes.
  const probe1 = makeLeg([...toStop, stop], from, atDoor, 1, 0.4);
  const probe2 = makeLeg([stop, ...toRoom], atDoor, end, 1, 0.85);
  const share = probe1.weighted / (probe1.weighted + probe2.weighted);
  const leg1 = makeLeg([...toStop, stop], from, atDoor, seconds * share, 0.4);
  // After the door opens, glide in with the robot, arriving as it sits down.
  const leg2 = makeLeg(
    [stop, ...toRoom],
    atDoor,
    end,
    VAULT_GREETING.seated - VAULT_GREETING.swing,
    0.85, // a short leg: turn from the door to the desk almost all the way
  );
  return route([leg1, leg2], VAULT_GREETING.swing);
}

/** The route points already past a point that's partway along them are dropped (the reverse of fromPartway). */
function upTo(end: THREE.Vector3, points: THREE.Vector3[]): THREE.Vector3[] {
  return fromPartway(end, [...points].reverse()).reverse();
}

/**
 * Out of a control room, back to the belt view `to`: the flight in, played in
 * reverse. It backs out facing where it came from (the robot, the hallway, the
 * hub, then the whole station shrinking away) and settles on the belt view, so
 * it never has to turn round. Starting partway (Back pressed mid-flight), it
 * backs out from wherever the camera is.
 */
export function routeOut(room: StationRoom, from: Pose, to: Pose): Route {
  const seconds = withSwing(LOOK.flights.fromStationSeconds, to.position);
  if (!inside(from.position)) {
    // Still outside (Back pressed early in the flight in): just pull back to the belt view.
    const back = makeLeg([to.position.clone(), from.position.clone()], to, from, seconds, 0.3);
    return { duration: seconds, doorStop: null, sample: (t) => back.sample(seconds - t) };
  }
  const path = hatchToRoom(room, { stopAtDoor: false });
  const approach = inside(to.position) ? [] : approachFrom(to.position, room);
  const station = [...path.toHallway, ...path.toRoom.slice(0, -1)];
  const pts = [
    to.position.clone(),
    ...approach,
    ...upTo(from.position, station),
    from.position.clone(),
  ];
  const atRoom = from.position.distanceTo(roomPose(room).position) < 0.05;
  const inward = makeLeg(pts, to, from, seconds, atRoom ? path.toRoom[0]! : 0.3);
  return { duration: seconds, doorStop: null, sample: (t) => inward.sample(seconds - t) };
}

/** From one control room to the other, through the hallways and the hub. */
export function routeBetween(
  fromRoom: StationRoom,
  toRoom: StationRoom,
  from: Pose,
  opts: { stopAtDoor: boolean },
): Route {
  // Still outside (switched rooms early in the flight in): go in through the hatch to the other room.
  if (!inside(from.position)) return routeIn(toRoom, from, opts);
  const a = towards(fromRoom);
  const out = roomToHub(fromRoom);
  const hub = [v(a * 0.9, EYE + 0.1, 0.35), v(0, EYE + 0.15, 0.55), v(-a * 0.9, EYE + 0.1, 0.35)];
  const path = hatchToRoom(toRoom, { stopAtDoor: opts.stopAtDoor && toRoom === "finance" });
  const inHall = path.toHallway[3]!;
  const first = fromPartway(from.position, [roomPose(fromRoom).position, ...out, ...hub, inHall]);
  const end = roomPose(toRoom);
  if (!path.stop) {
    const pts = [from.position.clone(), ...first, ...path.toRoom];
    return route([makeLeg(pts, from, end, LOOK.flights.roomToRoomSeconds, path.toRoom[0]!)], 0);
  }
  return doorRoute(
    from,
    [from.position.clone(), ...first],
    path.stop,
    path.toRoom,
    end,
    LOOK.flights.roomToRoomSeconds,
  );
}
