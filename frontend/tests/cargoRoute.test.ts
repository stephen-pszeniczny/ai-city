// Tests for where the cargo shuttle flies and docks in each building view. Run: npm test.
import assert from "node:assert/strict";
import { test } from "node:test";
import * as THREE from "three";

import { asteroidDock, roomDock, type Dock } from "../src/belt/cargoRoute.ts";
import { DECK_R } from "../src/belt/growth/deck.ts";
import { asteroidScaleAt } from "../src/belt/growth/ladders.ts";
import { pointOnPath } from "../src/notifications/shuttlePath.ts";
import { ASTEROIDS, make } from "./growthStub.ts";
import { MODULE_X, ROOM_OFFSET, ROOM_SIZE, roomView } from "../src/interior/stationLayout.ts";
import { DESK_SPOT } from "../src/interior/workspace.ts";
import { onScreen, PROTECTED } from "./dishScreen.ts";

const FOV = 55;
const ASPECTS = [4 / 3, 16 / 10, 21 / 9];

function view(from: THREE.Vector3, to: THREE.Vector3, aspect: number) {
  const camera = new THREE.PerspectiveCamera(FOV, aspect, 0.5, 1000);
  camera.position.copy(from);
  camera.lookAt(to);
  camera.updateMatrixWorld(true);
  return camera;
}

/** Screen position, -1 to 1 each way. */
const ndc = (camera: THREE.Camera, p: THREE.Vector3) => p.clone().project(camera);

function checkFlight(camera: THREE.PerspectiveCamera, dock: Dock) {
  const at = ndc(camera, dock.at);
  assert.ok(Math.abs(at.x) < 0.9 && Math.abs(at.y) < 0.7 && at.z < 1, `dock at ${at.x},${at.y}`);
  // It arrives from off screen and leaves off screen, ending and starting at the dock.
  for (const end of [dock.inbound.from, dock.outbound.to]) {
    const p = ndc(camera, end);
    assert.ok(Math.abs(p.x) > 1.05 || Math.abs(p.y) > 1.05, `starts on screen at ${p.x},${p.y}`);
  }
  assert.ok(pointOnPath(dock.inbound, 1).distanceTo(dock.at) < 1e-6);
  assert.ok(pointOnPath(dock.outbound, 0).distanceTo(dock.at) < 1e-6);
  // Never right in front of the lens.
  for (let k = 0; k <= 1; k += 0.02) {
    for (const path of [dock.inbound, dock.outbound]) {
      assert.ok(pointOnPath(path, k).distanceTo(camera.position) > 2);
    }
  }
}

test("on an asteroid the shuttle docks in view, just off the deck, clear of the desk", () => {
  for (const id of ASTEROIDS) {
    for (const aspect of ASPECTS) {
      for (const tier of [0, 10]) {
        const scale = asteroidScaleAt(tier, id);
        const dock = asteroidDock(id, FOV, aspect, scale);
        const camera = view(DESK_SPOT.camera, DESK_SPOT.screen, aspect);
        checkFlight(camera, dock);
        const radius = Math.hypot(dock.at.x, dock.at.z);
        assert.ok(radius > DECK_R * scale + 0.4, `${id}: over the deck: ${radius}`);
        assert.ok(radius < DECK_R * scale + 3, `${id}: far from the deck: ${radius}`);
        assert.ok(dock.at.y > 0.4, "above the deck");
        // Its tether ends on the deck's edge.
        assert.ok(Math.abs(Math.hypot(dock.edge.x, dock.edge.z) - DECK_R * scale) < 0.05);
        assert.ok(Math.abs(dock.edge.y) < 0.1);
        // Beside the robot, desk and monitor on screen, not over them.
        const p = onScreen(dock.at);
        const half = dock.size / 2 / depthScale(camera, dock.at);
        for (const [name, hull] of Object.entries(PROTECTED)) {
          const xs = hull.map((h) => h.x);
          const clear = p.x + half < Math.min(...xs) || p.x - half > Math.max(...xs);
          assert.ok(clear, `${id}: over the ${name}`);
        }
      }
    }
  }
});

/** Points on everything grown on an asteroid at `tier`, over a stretch of its movement. */
function grownPoints(id: (typeof ASTEROIDS)[number], tier: number): THREE.Vector3[] {
  const { growth } = make(id);
  growth.setTier(tier);
  const points: THREE.Vector3[] = [];
  for (let t = 0; t < 40; t += 2) {
    growth.update(t);
    for (const root of [growth.pieces, growth.landmark()]) {
      root.updateWorldMatrix(true, true);
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        // Light effects (beams, rings, the ship looping the belt) may pass through.
        if (!mesh.isMesh || (mesh.material as THREE.Material).blending === THREE.AdditiveBlending) {
          return;
        }
        const p = mesh.geometry.getAttribute("position");
        for (let i = 0; i < p.count; i += 5) {
          points.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld));
        }
      });
    }
  }
  return points;
}

test("on its way in, docked and on its way out, the shuttle flies through nothing grown", () => {
  for (const id of ASTEROIDS) {
    for (const tier of [0, 2, 3, 6, 9, 10]) {
      const points = grownPoints(id, tier);
      // The dock is set from the size the asteroid had when the moment began.
      const dock = asteroidDock(id, FOV, 16 / 10, asteroidScaleAt(Math.max(0, tier - 1), id));
      const way: THREE.Vector3[] = [];
      for (let k = 0; k <= 1.001; k += 0.05) {
        way.push(pointOnPath(dock.inbound, k), pointOnPath(dock.outbound, k));
      }
      for (const k of [-0.5, -0.25, 0, 0.25, 0.5]) {
        way.push(dock.at.clone().addScaledVector(dock.heading, k * dock.size));
      }
      let closest = Infinity;
      for (const p of points) for (const w of way) closest = Math.min(closest, p.distanceTo(w));
      // The hull is about 0.45 of its length wide and 0.3 tall.
      assert.ok(closest > dock.size * 0.4, `${id} tier ${tier}: ${closest.toFixed(2)}`);
    }
  }
});

/** World units per view height at a point. */
function depthScale(camera: THREE.PerspectiveCamera, p: THREE.Vector3) {
  const depth = -p.clone().applyMatrix4(camera.matrixWorldInverse).z;
  return 2 * depth * Math.tan(THREE.MathUtils.degToRad(FOV / 2));
}

for (const id of ["planner", "finance"] as const) {
  test(`${id}: the shuttle docks outside the control room's window, seen through the glass`, () => {
    const rv = roomView(id);
    const room = new THREE.Vector3(MODULE_X[id], 0, 0).add(ROOM_OFFSET);
    for (const aspect of ASPECTS) {
      const camera = view(room.clone().add(rv.camera), room.clone().add(rv.screen), aspect);
      const dock = roomDock(id, FOV, aspect);
      checkFlight(camera, dock);
      const local = dock.at.clone().sub(room);
      assert.ok(local.z > ROOM_SIZE.front + 0.8, "outside the room");
      // Its tether lands just outside the window's sill, not in mid-air across the glass.
      const edge = dock.edge.clone().sub(room);
      assert.ok(edge.y < 0.4 && edge.z > ROOM_SIZE.front && edge.z < ROOM_SIZE.front + 0.3);
      // The whole way in and out stays outside the window: it never flies through the room.
      for (let k = 0; k <= 1; k += 0.02) {
        for (const path of [dock.inbound, dock.outbound]) {
          assert.ok(pointOnPath(path, k).z - room.z > ROOM_SIZE.front + 0.5);
        }
      }
      // The line of sight to it, and to both ends of the hull, passes through the glass.
      const eye = rv.camera;
      for (const dx of [-dock.size / 2, 0, dock.size / 2]) {
        const target = local.clone().add(new THREE.Vector3(dx, 0, 0));
        const k = (ROOM_SIZE.front - eye.z) / (target.z - eye.z);
        const through = eye.clone().lerp(target, k);
        assert.ok(Math.abs(through.x) < ROOM_SIZE.width / 2 - 0.1, `frame x ${through.x}`);
        assert.ok(through.y > 0.4 && through.y < ROOM_SIZE.height - 0.15, `frame y ${through.y}`);
      }
      // Not hidden behind the monitor in the middle of the view.
      const at = ndc(camera, dock.at);
      assert.ok(Math.abs(at.x * (aspect / 2)) > 0.2 || at.y > 0.3, `behind the screen ${at.x}`);
    }
  });
}
