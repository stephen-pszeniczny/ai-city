// What the Opportunity Office building view shows of the radar dish, measured on
// screen against the robot, desk and monitor.
//
// Units are view heights: (0, 0) is the middle of the view, y goes up, and the top
// edge is y = 0.5. The lens is a fixed vertical angle, so a point has the same
// place in these units at every window shape; only the left and right edges move.
// So one measurement of a gap holds for all shapes.
import * as THREE from "three";

import { DECK_R } from "../src/belt/growth/deck.ts";
import { DESK, SCREEN } from "../src/interior/deskSize.ts";
import { DESK_SPOT, MONITOR_AT, MONITOR_TURN, workToDeck } from "../src/interior/workspace.ts";
import { shown, type make } from "./growthStub.ts";

/** The building view's vertical field of view (FOV.inside in belt/CameraRig.tsx). */
export const VIEW_FOV = 55;

const camera = new THREE.PerspectiveCamera(VIEW_FOV, 1, 0.1, 1000);
camera.position.copy(DESK_SPOT.camera);
camera.lookAt(DESK_SPOT.screen);
camera.updateMatrixWorld(true);

type P = { x: number; y: number };

/** A deck point on screen, in view heights. Throws if it's at or behind the lens. */
export function onScreen(v: THREE.Vector3): P {
  const local = v.clone().applyMatrix4(camera.matrixWorldInverse);
  if (local.z > -0.3) throw new Error("something reaches the camera");
  const k = 1 / (-local.z * 2 * Math.tan(THREE.MathUtils.degToRad(VIEW_FOV / 2)));
  return { x: local.x * k, y: local.y * k };
}

/** True where the deck's solid top is between the lens and the point. */
function underDeck(v: THREE.Vector3): boolean {
  if (v.y >= -0.01) return false;
  const eye = camera.position;
  const k = eye.y / (eye.y - v.y);
  return Math.hypot(eye.x + (v.x - eye.x) * k, eye.z + (v.z - eye.z) * k) < DECK_R;
}

const cross = (o: P, a: P, b: P) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** The convex hull, anticlockwise. */
function hull(points: P[]): P[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const half = (list: P[]) => {
    const out: P[] = [];
    for (const p of list) {
      while (out.length > 1 && cross(out.at(-2)!, out.at(-1)!, p) <= 0) out.pop();
      out.push(p);
    }
    return out.slice(0, -1);
  };
  return [...half(sorted), ...half(sorted.reverse())];
}

function corners(lo: number[], hi: number[]): THREE.Vector3[] {
  return [0, 1, 2, 3, 4, 5, 6, 7].map(
    (i) => new THREE.Vector3(i & 1 ? hi[0] : lo[0], i & 2 ? hi[1] : lo[1], i & 4 ? hi[2] : lo[2]),
  );
}

const turn = new THREE.Quaternion().setFromEuler(MONITOR_TURN);
const half = { x: SCREEN.width / 2 + 0.02, y: SCREEN.height / 2 };

/**
 * What must stay clear, each as the outline of a box in workspace coordinates
 * (interior/Robot.tsx, Desk.tsx, DeskProps.tsx, Monitor.tsx).
 */
export const PROTECTED: Record<"robot" | "desk" | "monitor", P[]> = {
  // The robot on its chair, with room to wave, stretch and spin.
  robot: hull(corners([-0.65, 0, -0.45], [0.65, 1.7, 0.5]).map((v) => onScreen(workToDeck(v)))),
  // The desk with everything on it: lamp, plant, gadget, glass.
  desk: hull(
    corners([-DESK.width / 2 - 0.05, 0, 0.44], [DESK.width / 2 + 0.05, 1.2, 1.13]).map((v) =>
      onScreen(workToDeck(v)),
    ),
  ),
  // The display and its stand.
  monitor: hull(
    corners([-half.x, -half.y - 0.23, -0.02], [half.x, half.y + 0.02, 0.22]).map((v) =>
      onScreen(workToDeck(v.applyQuaternion(turn).add(MONITOR_AT))),
    ),
  ),
};

function toSegment(p: P, a: P, b: P): number {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  const length = dx * dx + dy * dy;
  const k = length ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length)) : 0;
  return Math.hypot(p.x - a.x - k * dx, p.y - a.y - k * dy);
}

/** True if a line through some edge of `shape` has all of `other` on its outer side. */
function separated(shape: P[], other: P[]): boolean {
  return shape.some((a, i) => {
    const b = shape[(i + 1) % shape.length]!;
    return other.every((p) => cross(a, b, p) < 0);
  });
}

/** The gap between a screen triangle and a protected outline; 0 if they overlap. */
function gapBetween(triangle: P[], outline: P[]): number {
  if (cross(triangle[0]!, triangle[1]!, triangle[2]!) < 0) triangle.reverse();
  if (!separated(outline, triangle) && !separated(triangle, outline)) return 0;
  let gap = Infinity;
  for (const [points, edges] of [
    [triangle, outline],
    [outline, triangle],
  ] as const) {
    for (const p of points) {
      edges.forEach((a, i) => {
        gap = Math.min(gap, toSegment(p, a, edges[(i + 1) % edges.length]!));
      });
    }
  }
  return gap;
}

const boxOf = (points: P[]) => ({
  left: Math.min(...points.map((p) => p.x)),
  right: Math.max(...points.map((p) => p.x)),
  bottom: Math.min(...points.map((p) => p.y)),
  top: Math.max(...points.map((p) => p.y)),
});
export type Rect = ReturnType<typeof boxOf>;

const OUTLINES = Object.entries(PROTECTED).map(([name, outline]) => ({
  name,
  outline,
  box: boxOf(outline),
}));

const grow = (into: Rect, p: P) => {
  into.left = Math.min(into.left, p.x);
  into.right = Math.max(into.right, p.x);
  into.bottom = Math.min(into.bottom, p.y);
  into.top = Math.max(into.top, p.y);
};
const nothing = (): Rect => ({
  left: Infinity,
  right: -Infinity,
  bottom: Infinity,
  top: -Infinity,
});

/**
 * Everything the landmark (and its signal rings) covers on screen through whole
 * turns of every dish: the smallest gap to the robot, desk or monitor, the room it
 * takes up, and the room each turning dish takes up. What the deck wholly hides
 * (supports under it) doesn't count.
 */
export function sweepLandmark(a: ReturnType<typeof make>, degreeStep = 4) {
  const rings = a.growth.pieces.getObjectByName("signalRings");
  const roots = [a.growth.landmark(), ...(rings ? [rings] : [])];
  const heads: THREE.Object3D[] = [];
  roots[0]!.traverse((o) => void (o.name === "dishHead" && heads.push(o)));
  const inAHead = (o: THREE.Object3D): boolean =>
    heads.includes(o) || (!!o.parent && inAHead(o.parent));

  let gap = Infinity;
  let nearest = "";
  const all = nothing();
  /** The same without the support booms: dishes, masts and platforms. */
  const standing = nothing();
  const inBoom = (o: THREE.Object3D): boolean =>
    o.name === "boom" || (!!o.parent && inBoom(o.parent));
  const dishes = heads.map(nothing);
  const done = new Set<string>();
  const v = new THREE.Vector3();
  const measure = (mesh: THREE.Mesh, into: Rect[]) => {
    const key = `${mesh.id}:${mesh.matrixWorld.elements.map((e) => e.toFixed(3)).join()}`;
    if (done.has(key)) return;
    done.add(key);
    const p = mesh.geometry.attributes.position as THREE.BufferAttribute;
    const points: P[] = [];
    const hidden: boolean[] = [];
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
      points.push(onScreen(v));
      hidden.push(underDeck(v));
      if (!hidden[i]) for (const rect of into) grow(rect, points[i]!);
    }
    const index = mesh.geometry.index;
    const corners = index ? index.count : p.count;
    for (let i = 0; i + 2 < corners; i += 3) {
      const at = [0, 1, 2].map((k) => (index ? index.getX(i + k) : i + k));
      if (at.every((k) => hidden[k])) continue;
      const tri = at.map((k) => points[k]!);
      const box = boxOf(tri);
      for (const o of OUTLINES) {
        const apart = Math.hypot(
          Math.max(0, o.box.left - box.right, box.left - o.box.right),
          Math.max(0, o.box.bottom - box.top, box.bottom - o.box.top),
        );
        if (apart >= gap) continue;
        const exact = gapBetween([...tri], o.outline);
        if (exact < gap) [gap, nearest] = [exact, o.name];
      }
    }
  };
  const meshesUnder = (root: THREE.Object3D) => {
    const out: THREE.Mesh[] = [];
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && shown(o)) out.push(o as THREE.Mesh);
    });
    return out;
  };

  // What moves along the cables and the signal rings: a few cycles of each.
  for (let t = 0; t <= 15; t += 0.25) {
    a.growth.update(t);
    a.world.updateMatrixWorld(true);
    for (const root of roots) {
      for (const mesh of meshesUnder(root))
        if (!inAHead(mesh)) measure(mesh, inBoom(mesh) ? [all] : [all, standing]);
    }
  }
  // Each dish all the way round, whatever its speed.
  heads.forEach((head, h) => {
    for (let degrees = 0; degrees < 360; degrees += degreeStep) {
      head.rotation.y = THREE.MathUtils.degToRad(degrees);
      head.updateWorldMatrix(true, true);
      for (const mesh of meshesUnder(head)) measure(mesh, [all, standing, dishes[h]!]);
    }
  });
  return { gap, nearest, all, standing, dishes };
}
