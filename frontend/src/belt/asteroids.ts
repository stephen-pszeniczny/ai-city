// The seven asteroid buildings on the ring. A built one shows its landmark;
// an unbuilt one shows a mining rig, scaffolding and an "under construction" sign.
import * as THREE from "three";

import type { BuildingId } from "../api";
import { BUILT } from "./built";
import { createConstructionSign, createWorksite } from "./construction";
import { createLandmark } from "./landmarks";
import type { Kit } from "./materials";
import { ASTEROIDS, orbitPosition, rockGeometry } from "./space";

export type AsteroidBuilding = {
  id: BuildingId;
  group: THREE.Group;
  /** Label position, local to the (non-spinning) asteroid group. */
  anchor: THREE.Vector3;
  update(t: number, speed: number, camera: THREE.Camera): void;
};

const DECK_Y = 1.62;

export function createAsteroids(kit: Kit): AsteroidBuilding[] {
  const { mats, glow, keep, addBlinker } = kit;
  return ASTEROIDS.map((def, i) => {
    const group = new THREE.Group(); // follows the orbit
    const spin = new THREE.Group(); // turns with the asteroid
    group.add(spin);
    group.traverse((o) => (o.userData.buildingId = def.id));

    const rock = new THREE.Mesh(
      keep(rockGeometry(i * 3.7 + 1.3, def.tint)),
      keep(
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.04 }),
      ),
    );
    rock.scale.setScalar(3.6);
    rock.castShadow = true;
    rock.receiveShadow = true;
    const deck = new THREE.Mesh(
      keep(new THREE.CylinderGeometry(1.9, 2.1, 0.32, 40)),
      mats.darkMetal,
    );
    deck.position.y = 1.45;
    const rim = new THREE.Mesh(
      keep(new THREE.TorusGeometry(2.0, 0.04, 6, 64)),
      glow(def.tint, 2.2),
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = DECK_Y;
    spin.add(rock, deck, rim);
    const winGeo = keep(new THREE.BoxGeometry(0.22, 0.12, 0.04));
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.3;
      const w = new THREE.Mesh(winGeo, mats.window);
      w.position.set(Math.cos(a) * 1.92, 1.42, Math.sin(a) * 1.92);
      w.lookAt(Math.cos(a) * 5, 1.42, Math.sin(a) * 5);
      spin.add(w);
    }
    addBlinker(spin, new THREE.Vector3(2.3, 0.6, 0.6), def.tint, 2.4 + i * 0.13, i * 0.37, {
      size: 0.1,
    });

    const holder = new THREE.Group();
    holder.position.y = DECK_Y;
    spin.add(holder);

    const updates: ((t: number) => void)[] = [];
    let signFace: THREE.Group | null = null;
    if (BUILT.has(def.id)) {
      const lm = createLandmark(def.id as Parameters<typeof createLandmark>[0], def.tint, kit);
      holder.add(lm.group);
      updates.push(lm.update);
    } else {
      const site = createWorksite(kit, def.tint);
      holder.add(site.group);
      updates.push(site.update);
      // The sign stands at the deck's front edge and doesn't spin, so it reads well.
      const sign = createConstructionSign(kit, 0.9);
      sign.group.position.set(0, DECK_Y, 1.25);
      group.add(sign.group);
      signFace = sign.face;
    }
    group.traverse((o) => (o.userData.buildingId = def.id));

    const spinRate = (i % 2 ? -1 : 1) * (0.03 + i * 0.006);
    const camPos = new THREE.Vector3();
    const facePos = new THREE.Vector3();
    return {
      id: def.id,
      group,
      anchor: new THREE.Vector3(0, BUILT.has(def.id) ? 6.2 : 5.0, 0),
      update(t, speed, camera) {
        const [x, y, z] = orbitPosition(def.angleDeg, t, speed);
        group.position.set(x, y, z);
        spin.rotation.y = t * spinRate;
        updates.forEach((u) => u(t));
        if (signFace) {
          camera.getWorldPosition(camPos);
          signFace.getWorldPosition(facePos);
          signFace.lookAt(camPos.x, facePos.y, camPos.z); // turn on the vertical axis only
        }
      },
    };
  });
}
