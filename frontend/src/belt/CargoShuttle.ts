// The level-up's cargo shuttle: a stubby freighter with a lit cab, cargo pods in
// the building's colour and two engines. It flies in, holds at its dock with a
// tether down to the building, sends the cargo along it while the new pieces
// build, then flies off. Built along +z (its nose), one unit long. It takes no
// clicks and frees everything it made. Nothing is allocated while it animates.
import * as THREE from "three";

import { pointOnPath } from "../notifications/shuttlePath.ts";
import type { Dock } from "./cargoRoute.ts";
import { noClicks } from "./growth/parts.ts";
import { LOOK } from "./look.ts";
import { softGlow } from "./space/noise.ts";

const CRATES = 5;
const UP = new THREE.Vector3(0, 1, 0);

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (x: number) => 1 - (1 - x) ** 3;

export type CargoPose = {
  /** 0 off screen, 1 at the dock. */
  arrive: number;
  /** How far the tether has reached: 0 none, 1 touching. */
  tether: number;
  /** Cargo sliding down the tether (0 to 1 over the build), or -1 for none. */
  unload: number;
  /** 0 at the dock, 1 gone. */
  depart: number;
};

export function createCargoShuttle(dock: Dock, tint: string, texture = softGlow()) {
  const group = new THREE.Group();
  group.name = "cargoShuttle";
  const ship = new THREE.Group();
  ship.scale.setScalar(dock.size);
  const owned: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    owned.push(x);
    return x;
  };
  const std = (o: THREE.MeshStandardMaterialParameters) => keep(new THREE.MeshStandardMaterial(o));
  const basic = (o: THREE.MeshBasicMaterialParameters) => keep(new THREE.MeshBasicMaterial(o));
  const colour = new THREE.Color(tint);

  const hull = std({ color: 0xe9edf4, roughness: 0.55, metalness: 0.15, emissive: 0x424852 });
  const dark = std({ color: 0x2b313c, roughness: 0.45, metalness: 0.8, emissive: 0x0c0f16 });
  const pod = std({
    color: colour,
    roughness: 0.5,
    metalness: 0.35,
    emissive: colour,
    emissiveIntensity: 0.45,
  });
  const stripe = std({ color: 0xf0b23c, roughness: 0.4, metalness: 0.6, emissive: 0x4a3204 });
  const glass = std({
    color: 0x0b1a40,
    roughness: 0.1,
    metalness: 0.7,
    emissive: 0x3f6bff,
    emissiveIntensity: 0.9,
  });
  const lamp = basic({
    color: new THREE.Color(1, 0.93, 0.75).multiplyScalar(2.2),
    toneMapped: false,
  });
  const red = basic({ color: new THREE.Color(3, 0.3, 0.2), toneMapped: false });
  const green = basic({ color: new THREE.Color(0.3, 3, 0.9), toneMapped: false });
  const additive = {
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  } as const;
  const flameMat = basic({
    ...additive,
    color: new THREE.Color(0.2, 0.5, 1).multiplyScalar(3),
    opacity: 0.8,
  });
  const beamMat = basic({ ...additive, color: colour.clone().multiplyScalar(2), opacity: 0.4 });

  const add = (
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
  ) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  const boxGeo = keep(new THREE.BoxGeometry(1, 1, 1));
  const box = (
    w: number,
    h: number,
    d: number,
    m: THREE.Material,
    x: number,
    y: number,
    z: number,
  ) => add(ship, boxGeo, m, x, y, z).scale.set(w, h, d);
  const tubeGeo = keep(new THREE.CylinderGeometry(1, 1, 1, 18));
  const ballGeo = keep(new THREE.SphereGeometry(1, 14, 10));

  // The cab at the front, the spine, and three cargo pods strapped along it.
  box(0.24, 0.19, 0.22, hull, 0, 0.02, 0.36);
  box(0.2, 0.075, 0.03, glass, 0, 0.065, 0.475);
  box(0.245, 0.025, 0.225, stripe, 0, -0.035, 0.36);
  box(0.09, 0.07, 0.72, dark, 0, -0.03, -0.08);
  for (const z of [0.14, -0.07, -0.28]) {
    box(0.31, 0.2, 0.17, pod, 0, 0.04, z);
    box(0.32, 0.21, 0.025, stripe, 0, 0.04, z);
    for (const side of [-1, 1]) box(0.012, 0.035, 0.1, lamp, side * 0.158, 0.085, z);
  }
  // Two engines at the back, each with a flame.
  const flames: THREE.Mesh[] = [];
  const coneGeo = keep(new THREE.ConeGeometry(0.06, 0.3, 14, 1, true));
  for (const side of [-1, 1]) {
    const engine = add(ship, tubeGeo, hull, side * 0.2, -0.03, -0.41);
    engine.scale.set(0.075, 0.2, 0.075);
    engine.rotation.x = Math.PI / 2;
    box(0.16, 0.025, 0.1, dark, side * 0.11, -0.03, -0.41);
    const flame = add(ship, coneGeo, flameMat, side * 0.2, -0.03, -0.66);
    flame.rotation.x = -Math.PI / 2; // the tip points back
    flames.push(flame);
  }
  const lights = [
    add(ship, ballGeo, red, 0.3, -0.03, -0.41),
    add(ship, ballGeo, green, -0.3, -0.03, -0.41),
    add(ship, ballGeo, lamp, 0, 0.16, 0.34),
  ];
  for (const l of lights) l.scale.setScalar(0.022);

  const sprite = (c: THREE.Color) =>
    keep(new THREE.SpriteMaterial({ ...additive, map: texture, color: c, opacity: 0 }));
  const engineGlow = sprite(new THREE.Color(0.45, 0.7, 1).multiplyScalar(1.8));
  for (const side of [-1, 1]) {
    const s = new THREE.Sprite(engineGlow);
    s.position.set(side * 0.2, -0.03, -0.56);
    s.scale.setScalar(0.4);
    ship.add(s);
  }
  // A soft halo, so it stands out against dark space.
  const haloMat = sprite(colour.clone().multiplyScalar(1.2));
  const halo = new THREE.Sprite(haloMat);
  halo.scale.set(1.9, 1.1, 1);
  ship.add(halo);

  // The tether: a beam down to the building, a ring where it lands, and cargo on it.
  const tether = new THREE.Group();
  const beam = add(tether, tubeGeo, beamMat, 0, 0, 0);
  const ring = add(tether, keep(new THREE.TorusGeometry(1, 0.12, 8, 32)), beamMat, 0, 0, 0);
  const along = dock.edge.clone().sub(dock.at);
  const reach = along.length();
  along.normalize();
  const turn = new THREE.Quaternion().setFromUnitVectors(UP, along);
  beam.quaternion.copy(turn);
  ring.quaternion
    .copy(turn)
    .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0)));
  const crates = Array.from({ length: CRATES }, () => {
    const crate = add(tether, boxGeo, lamp, 0, 0, 0);
    crate.scale.setScalar(dock.size * 0.065);
    return crate;
  });

  group.add(ship, tether);
  noClicks(group);

  const here = new THREE.Vector3();
  const ahead = new THREE.Vector3();
  const lookFrom = new THREE.Matrix4();
  const docked = new THREE.Quaternion().setFromRotationMatrix(
    lookFrom.lookAt(dock.heading, new THREE.Vector3(), UP),
  );
  const flying = new THREE.Quaternion();
  /** The quaternion that points the nose (+z) along the path at k. */
  const along2 = (path: Dock["inbound"], k: number) => {
    pointOnPath(path, Math.min(1, k + 0.02), ahead);
    pointOnPath(path, Math.max(0, k - 0.02), here);
    return flying.setFromRotationMatrix(lookFrom.lookAt(ahead, here, UP));
  };

  return {
    group,
    ship,
    /** Put the shuttle where `pose` says, at time t (seconds). */
    update(t: number, pose: CargoPose) {
      const glow = LOOK.growth.pieceGlow;
      const leaving = pose.depart > 0;
      const path = leaving ? dock.outbound : dock.inbound;
      const k = leaving ? clamp01(pose.depart) ** 2 : easeOut(clamp01(pose.arrive));
      // Turn from the way it flew in to its docked heading as it slows.
      const turning = leaving ? clamp01(pose.depart * 3) : 1 - clamp01((pose.arrive - 0.55) / 0.45);
      ship.quaternion.copy(docked).slerp(along2(path, k), turning);
      pointOnPath(path, k, ship.position);
      const still = !leaving && pose.arrive >= 1;
      if (still) ship.position.y += Math.sin(t * 2.2) * dock.size * 0.025;

      const thrust = still ? 0.35 : 1;
      const flicker = 0.9 + 0.1 * Math.sin(t * 31) * Math.sin(t * 17);
      // By index here and below: this runs every frame, and should make nothing.
      for (let i = 0; i < flames.length; i++) {
        flames[i]!.scale.set(thrust, thrust * flicker, thrust);
      }
      flameMat.opacity = still ? 0.65 : 0.85;
      engineGlow.opacity = 0.75 * thrust * flicker;
      haloMat.opacity = 0.16 * glow;
      lights[0]!.visible = lights[1]!.visible = t % 1.1 < 0.65;
      lights[2]!.visible = t % 0.8 < 0.14;

      const out = leaving ? 1 - clamp01(pose.depart * 4) : clamp01(pose.tether);
      tether.visible = out > 0.01;
      if (!tether.visible) return;
      const length = reach * out;
      beam.position.copy(dock.at).addScaledVector(along, length / 2);
      beam.scale.set(dock.size * 0.03, length, dock.size * 0.03);
      beamMat.opacity = (0.32 + 0.1 * Math.sin(t * 9)) * glow;
      ring.position.copy(dock.at).addScaledVector(along, length);
      ring.scale.setScalar(dock.size * (0.14 + 0.03 * Math.sin(t * 6)));
      for (let i = 0; i < crates.length; i++) {
        const crate = crates[i]!;
        const at = pose.unload < 0 ? -1 : pose.unload * 2.4 - i * 0.28;
        crate.visible = at > 0 && at < 1;
        if (!crate.visible) continue;
        crate.position.copy(dock.at).addScaledVector(along, at * length);
        crate.rotation.set(at * 5, at * 7, 0);
      }
    },
    dispose() {
      group.removeFromParent();
      owned.forEach((x) => x.dispose());
    },
  };
}

export type CargoShuttle = ReturnType<typeof createCargoShuttle>;
