// The seven asteroid buildings on the ring. A built one shows its landmark;
// an unbuilt one shows the landmark as a holographic projection with
// "UNDER CONSTRUCTION" floating over it, plus a mining rig and scaffolding.
import * as THREE from "three";

import type { BuildingId } from "../api";
import { BUILT } from "./built";
import { createConstructionSign, createWorksite } from "./construction";
import { createGrowth, type GrowthHandle } from "./growth/applyGrowth";
import { DECK_CENTRE_Y, DECK_R, DECK_Y, ROCK_SCALE } from "./growth/deck";
import { rockGround } from "./growth/ground";
import { createHoloBanner, makeHologram } from "./hologram";
import { createLandmark } from "./landmarks";
import { detailFor } from "./lod";
import { LOOK, motionScale } from "./look";
import { PROJECTOR_LENS, workToDeck } from "../interior/workspace";
import type { Kit } from "./materials";
import { ASTEROIDS, orbitPosition, rockGeometry } from "./space";
import { pebbleGeometry } from "./space/rock";
import { mulberry32 } from "../interior/robotBrain";

export type AsteroidBuilding = {
  id: BuildingId;
  group: THREE.Group;
  /** Label position, local to the (non-spinning) asteroid group. */
  anchor: THREE.Vector3;
  /** Turns with the asteroid; its deck top is at y = DECK_Y. The robot's desk sits here. */
  spin: THREE.Group;
  /** What stands on the deck (landmark and upgrades, or hologram + worksite + banner). */
  holder: THREE.Group;
  /** Upgrades: tier 0 until set. Only built buildings grow. */
  growth: GrowthHandle;
  /** Size the rock, deck and what stands on it (a level-up grows it gradually). */
  setScale(scale: number): void;
  /** The solid "under construction" sign for beside the robot's desk (made once), or null if built. */
  deskSign: THREE.Group | null;
  /** `hold`: the computer screen is open, so upgrade pieces stop moving. */
  update(t: number, speed: number, camera: THREE.Camera, hold?: boolean): void;
};

export { DECK_R, DECK_Y };

/** Banner size per unit of camera distance (about 200 px wide on a 900 px tall view). */
const BANNER_SCALE = 0.03;

export function createAsteroids(
  kit: Kit,
  { reducedMotion = false }: { reducedMotion?: boolean } = {},
): AsteroidBuilding[] {
  const { mats, glow, keep, addBlinker } = kit;
  const t0 = performance.now();
  const built = ASTEROIDS.map((def, i): AsteroidBuilding => {
    const group = new THREE.Group(); // follows the orbit
    const spin = new THREE.Group(); // turns with the asteroid
    group.add(spin);
    // What an upgrade makes bigger: the rock, the deck and what stands on it. It
    // scales about the deck's top (`grown` holds it there), so the deck stays at
    // the same height and the desk, camera and flights don't move.
    const grown = new THREE.Group();
    grown.position.y = DECK_Y;
    const body = new THREE.Group();
    body.position.y = -DECK_Y;
    grown.add(body);
    spin.add(grown);
    group.traverse((o) => (o.userData.buildingId = def.id));

    const rock = new THREE.Mesh(
      keep(rockGeometry(i * 3.7 + 1.3, def.tint)),
      keep(
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.04 }),
      ),
    );
    rock.scale.setScalar(ROCK_SCALE);
    rock.add(createBoulders(kit, rock.geometry, i * 5.1 + 2, def.tint));
    rock.castShadow = true;
    rock.receiveShadow = true;
    const deck = new THREE.Mesh(
      keep(new THREE.CylinderGeometry(DECK_R, DECK_R + 0.2, 0.32, 56)),
      mats.darkMetal,
    );
    deck.position.y = DECK_CENTRE_Y;
    const rim = new THREE.Mesh(
      keep(new THREE.TorusGeometry(DECK_R + 0.1, 0.045, 6, 96)),
      glow(def.tint, 2.2),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = DECK_Y;
    body.add(rock, deck, rim);
    const winGeo = keep(new THREE.BoxGeometry(0.22, 0.12, 0.04));
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + 0.3;
      const w = new THREE.Mesh(winGeo, mats.window);
      const r = DECK_R + 0.12;
      w.position.set(Math.cos(a) * r, DECK_CENTRE_Y - 0.03, Math.sin(a) * r);
      w.lookAt(Math.cos(a) * 9, DECK_CENTRE_Y - 0.03, Math.sin(a) * 9);
      body.add(w);
    }
    addBlinker(body, new THREE.Vector3(3.5, 0.8, 0.9), def.tint, 2.4 + i * 0.13, i * 0.37, {
      size: 0.1,
    });

    const holder = new THREE.Group();
    holder.position.y = DECK_Y;
    body.add(holder);
    // The same spot outside what grows, for upgrades that go on the robot's desk.
    const deskMount = new THREE.Group();
    deskMount.position.y = DECK_Y;
    spin.add(deskMount);

    const updates: ((t: number) => void)[] = [];
    let signFace: THREE.Group | null = null;
    const lm = createLandmark(def.id as Parameters<typeof createLandmark>[0], def.tint, kit);
    holder.add(lm.group);
    const setScale = (scale: number) => grown.scale.setScalar(scale);
    const growth = createGrowth({
      id: def.id,
      tint: def.tint,
      kit,
      built: BUILT.has(def.id),
      holder,
      desk: deskMount,
      landmark: lm,
      ground: rockGround(rock.geometry, ROCK_SCALE, DECK_Y),
      onScale: setScale,
    });
    // A built asteroid's landmark animates through its growth (it can change stage).
    if (!BUILT.has(def.id)) {
      updates.push(lm.update);
      // Not built yet: the landmark is only a holographic projection, with the
      // mining rig and scaffolding working at the deck's edge...
      // The projection floats above the deck, beamed up from the robot's desk projector.
      lm.group.position.y = LOOK.hologramHeight;
      const holo = makeHologram(lm.group, kit, def.tint);
      updates.push(holo.update);
      const beam = createBeam(kit, def.tint, workToDeck(PROJECTOR_LENS), LOOK.hologramHeight);
      holder.add(beam.mesh);
      updates.push(beam.update);
      const site = createWorksite(kit, def.tint);
      site.group.scale.setScalar(0.7);
      site.group.position.set(-1.3, 0, -2.4); // out of the building view, seen from the belt
      holder.add(site.group);
      updates.push(site.update);
      // ...and "UNDER CONSTRUCTION" floating over it. Hangs from the holder (so it
      // hides with it) but is turned to face the camera every frame.
      const bannerY = LOOK.hologramHeight + 4.4; // matches bannerTop below
      const banner = createHoloBanner(kit, bannerY);
      banner.group.position.set(0, bannerY, 0); // just above the hologram
      holder.add(banner.group);
      updates.push(banner.update);
      signFace = banner.face;
    }
    group.traverse((o) => (o.userData.buildingId = def.id));
    const deskSign = BUILT.has(def.id) ? null : createConstructionSign(kit, 0.42).group;
    if (deskSign) {
      deskSign.children[0]?.rotation.set(0, Math.PI, 0); // face the camera behind the robot
      deskSign.traverse((o) => (o.userData.buildingId = def.id));
    }

    const bannerTop = LOOK.hologramHeight + 4.4;
    const anchor = new THREE.Vector3(0, DECK_Y + (BUILT.has(def.id) ? 4.6 : bannerTop + 2), 0);
    const spinRate = (i % 2 ? -1 : 1) * (0.03 + i * 0.006);
    const camPos = new THREE.Vector3();
    const facePos = new THREE.Vector3();
    return {
      id: def.id,
      group,
      anchor,
      spin,
      holder,
      growth,
      setScale,
      deskSign,
      update(t, speed, camera, hold = false) {
        const [x, y, z] = orbitPosition(def.angleDeg, t, speed);
        group.position.set(x, y, z);
        spin.rotation.y = t * spinRate;
        updates.forEach((u) => u(t));
        if (BUILT.has(def.id)) {
          growth.update(t, { hold, motion: motionScale(reducedMotion) });
          camera.getWorldPosition(camPos);
          growth.setDetail(detailFor(camPos.distanceTo(group.position)));
          anchor.y = DECK_Y + growth.labelHeight();
        }
        if (signFace) {
          camera.getWorldPosition(camPos);
          signFace.getWorldPosition(facePos);
          signFace.lookAt(camPos.x, facePos.y, camPos.z); // turn on the vertical axis only
          // Keep the words a readable size on screen: farther away, bigger in the scene.
          // (Too small and the letters blur into a grey box.)
          const scale = THREE.MathUtils.clamp(camPos.distanceTo(facePos) * BANNER_SCALE, 0.6, 3.2);
          signFace.scale.setScalar(scale);
          signFace.position.y = 0.65 * scale; // bottom edge stays on the hologram's top
          // The label sits just above the banner's top edge.
          anchor.y = DECK_Y + bannerTop + 1.3 * scale + 0.4;
        }
      },
    };
  });
  performance.measure("asteroids", { start: t0 }); // see the browser's Performance panel
  return built;
}

/** A faint cone of light from the desk projector's lens up to the hologram's base. */
function createBeam(
  kit: Kit,
  tint: string,
  lens: THREE.Vector3,
  height: number,
): { mesh: THREE.Mesh; update(t: number): void } {
  const top = new THREE.Vector3(0, height, 0);
  const len = lens.distanceTo(top);
  const geo = kit.keep(new THREE.CylinderGeometry(0.8, 0.02, len, 32, 1, true));
  const mat = kit.keep(
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(tint).lerp(new THREE.Color(0x7fe8ff), 0.6),
      transparent: true,
      opacity: 0.07,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.copy(lens).add(top).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), top.clone().sub(lens).normalize());
  return {
    mesh,
    update(t) {
      mat.opacity = 0.045 + 0.015 * Math.sin(t * 5) + (Math.sin(t * 31) > 0.97 ? -0.03 : 0);
    },
  };
}

/** A scatter of loose boulders resting on the rock's sides (rock units: the rock mesh scales them). */
function createBoulders(
  kit: Kit,
  rockGeo: THREE.BufferGeometry,
  seed: number,
  tint: string,
): THREE.InstancedMesh {
  const COUNT = 16;
  const rng = mulberry32(Math.floor(seed * 100));
  const mesh = new THREE.InstancedMesh(
    kit.keep(pebbleGeometry(seed, 1)),
    kit.keep(
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x58524d).lerp(new THREE.Color(tint), 0.18),
        roughness: 0.95,
        metalness: 0.05,
        flatShading: true,
      }),
    ),
    COUNT,
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const pos = rockGeo.attributes.position as THREE.BufferAttribute;
  const nor = rockGeo.attributes.normal as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const o = new THREE.Object3D();
  let placed = 0;
  for (let tries = 0; placed < COUNT && tries < 2000; tries++) {
    const k = Math.floor(rng() * pos.count);
    p.fromBufferAttribute(pos, k);
    n.fromBufferAttribute(nor, k);
    // On the sides, below the deck, on ground that isn't too steep.
    if (p.y > 0.3 || p.y < -0.25 || n.y < 0.15) continue;
    const size = 0.025 + rng() * rng() * 0.07;
    o.position.copy(p).addScaledVector(n, size * 0.4);
    o.rotation.set(rng() * 6, rng() * 6, rng() * 6);
    o.scale.setScalar(size);
    o.updateMatrix();
    mesh.setMatrixAt(placed++, o.matrix);
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}
