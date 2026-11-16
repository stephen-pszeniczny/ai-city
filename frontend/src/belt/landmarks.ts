// Each asteroid's landmark, shown once its building is built (spec section 7).
import * as THREE from "three";

import type { BuildingId } from "../api";
import type { Kit } from "./materials";

type Landmark = { group: THREE.Group; update(t: number): void };
type AsteroidId = Exclude<BuildingId, "planner" | "finance">;

const cylX = (r: number, len: number, mat: THREE.Material, seg = 32) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.rotation.z = Math.PI / 2;
  return m;
};

export function createLandmark(id: AsteroidId, tint: string, kit: Kit): Landmark {
  const { mats, glow, keep, addBlinker } = kit;
  const g = new THREE.Group();
  const updates: ((t: number) => void)[] = [];
  const std = (o: THREE.MeshStandardMaterialParameters) => keep(new THREE.MeshStandardMaterial(o));

  switch (id) {
    case "jobs": {
      // Opportunity Office: a turning radar dish.
      const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 1.8, 10), mats.steel);
      mast.position.y = 0.9;
      const head = new THREE.Group();
      head.position.y = 1.9;
      const dish = new THREE.Mesh(
        new THREE.LatheGeometry(
          Array.from({ length: 9 }, (_, i) => new THREE.Vector2(i * 0.19, (i * 0.19) ** 2 * 0.42)),
          40,
        ),
        std({ color: 0xf2f4f8, roughness: 0.3, metalness: 0.4, side: THREE.DoubleSide }),
      );
      dish.rotation.x = -0.9;
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), glow(tint, 3.5));
      tip.position.set(0, 0.85, 0.66);
      head.add(dish, tip);
      g.add(mast, head);
      updates.push((t) => (head.rotation.y = t * 0.45));
      break;
    }
    case "mail": {
      // Post Office: a lattice antenna sending out pulses.
      const tower = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.55, 4.2, 4, 6, true),
        std({ color: 0xdfe3ea, wireframe: true, metalness: 0.6, roughness: 0.4 }),
      );
      tower.position.y = 2.1;
      g.add(tower);
      for (const y of [1.4, 2.6]) {
        const d = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.08, 20), mats.radiator);
        d.rotation.z = Math.PI / 2;
        d.position.set(0.3, y, 0);
        g.add(d);
      }
      const pulseMat = keep(
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(tint).multiplyScalar(3),
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      const pulse = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.025, 6, 48), pulseMat);
      pulse.position.y = 4.3;
      pulse.rotation.x = Math.PI / 2;
      g.add(pulse);
      addBlinker(g, new THREE.Vector3(0, 4.3, 0), tint, 1.8, 0.5, { size: 0.13 });
      updates.push((t) => {
        const k = (t * 0.45) % 1;
        pulse.scale.setScalar(1 + k * 5);
        pulseMat.opacity = (1 - k) * 0.9;
      });
      break;
    }
    case "gym": {
      // Training Bay: a barbell on a rack with a running track.
      for (const x of [-0.9, 0.9]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 1.3, 8), mats.steel);
        post.position.set(x, 0.65, 0);
        g.add(post);
      }
      const bar = cylX(0.1, 3.6, mats.steel, 12);
      bar.position.y = 1.4;
      g.add(bar);
      const plateMat = std({ color: tint, roughness: 0.35, metalness: 0.5 });
      for (const s of [-1, 1]) {
        const p1 = cylX(0.72, 0.34, mats.darkMetal);
        p1.position.set(s * 1.25, 1.4, 0);
        const p2 = cylX(0.52, 0.26, plateMat);
        p2.position.set(s * 1.58, 1.4, 0);
        g.add(p1, p2);
      }
      const track = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.04, 6, 96), glow(tint, 2));
      track.rotation.x = Math.PI / 2;
      track.position.y = 0.06;
      const runner = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), glow(tint, 7));
      g.add(track, runner);
      updates.push((t) =>
        runner.position.set(Math.cos(t * 1.4) * 1.9, 0.12, Math.sin(t * 1.4) * 1.9),
      );
      break;
    }
    case "projects": {
      // Shipyard: a slewing crane.
      const mat = std({ color: 0xffb36b, roughness: 0.5, metalness: 0.5 });
      const mast = new THREE.Mesh(new THREE.BoxGeometry(0.28, 3.6, 0.28), mat);
      mast.position.y = 1.8;
      const top = new THREE.Group();
      top.position.y = 3.5;
      const boom = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.18, 0.18), mat);
      boom.position.x = 1.3;
      const counter = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.5), mats.darkMetal);
      counter.position.x = -0.7;
      const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.4, 4), mats.steel);
      cable.position.set(2.7, -0.7, 0);
      const hook = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.4), mats.darkMetal);
      hook.position.set(2.7, -1.45, 0);
      top.add(boom, counter, cable, hook);
      g.add(mast, top);
      updates.push((t) => (top.rotation.y = Math.sin(t * 0.25) * 0.9));
      break;
    }
    case "relationships": {
      // Crew Quarters: a welcoming arch with flags.
      const arch = new THREE.Mesh(
        new THREE.TorusGeometry(1.25, 0.17, 16, 48, Math.PI),
        std({ color: 0xfbe6f0, roughness: 0.3, metalness: 0.3 }),
      );
      arch.position.y = 0.2;
      const inner = new THREE.Mesh(
        new THREE.TorusGeometry(1.25, 0.05, 8, 48, Math.PI),
        glow(tint, 2.4),
      );
      inner.position.set(0, 0.2, 0.18);
      g.add(arch, inner);
      for (const s of [-1, 1]) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.8, 6), mats.steel);
        pole.position.set(s * 2.0, 1.4, 0);
        const flag = new THREE.Mesh(
          new THREE.PlaneGeometry(0.9, 0.55),
          std({
            color: tint,
            roughness: 0.6,
            side: THREE.DoubleSide,
            emissive: tint,
            emissiveIntensity: 0.25,
          }),
        );
        flag.position.set(s * 2.0 + 0.45, 2.45, 0);
        g.add(pole, flag);
        updates.push((t) => (flag.rotation.y = Math.sin(t * 2 + s) * 0.25));
      }
      break;
    }
    case "career": {
      // Flight School: a small holographic spaceship hovering over a projector.
      const holoMat = keep(
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(tint).lerp(new THREE.Color(0x7fe8ff), 0.45).multiplyScalar(1.6),
          transparent: true,
          opacity: 0.45,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      const wireMat = keep(
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(0x9ff3ff).multiplyScalar(2.2),
          wireframe: true,
          transparent: true,
          opacity: 0.6,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      const projector = new THREE.Mesh(
        new THREE.CylinderGeometry(0.75, 0.9, 0.22, 32),
        mats.darkMetal,
      );
      projector.position.y = 0.11;
      const lens = new THREE.Mesh(
        new THREE.CylinderGeometry(0.55, 0.55, 0.03, 32),
        glow(0x7fe8ff, 3),
      );
      lens.position.y = 0.235;
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.15, 0.6, 1.5, 32, 1, true),
        keep(
          new THREE.MeshBasicMaterial({
            color: new THREE.Color(0x7fe8ff).multiplyScalar(0.7),
            transparent: true,
            opacity: 0.18,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
          }),
        ),
      );
      beam.position.y = 1.0;
      g.add(projector, lens, beam);

      // The ship: fuselage, nose, swept wings, tail fin and engine glow.
      const ship = new THREE.Group();
      const parts: THREE.BufferGeometry[] = [];
      const add = (
        geo: THREE.BufferGeometry,
        pos: [number, number, number],
        rot: [number, number, number] = [0, 0, 0],
      ) => {
        parts.push(geo);
        for (const m of [holoMat, wireMat]) {
          const mesh = new THREE.Mesh(geo, m);
          mesh.position.set(...pos);
          mesh.rotation.set(...rot);
          ship.add(mesh);
        }
      };
      add(new THREE.CylinderGeometry(0.16, 0.22, 1.2, 12), [0, 0, 0], [Math.PI / 2, 0, 0]);
      add(new THREE.ConeGeometry(0.16, 0.5, 12), [0, 0, 0.85], [Math.PI / 2, 0, 0]);
      add(new THREE.BoxGeometry(1.5, 0.04, 0.5), [0, -0.04, -0.15], [0, 0, 0]);
      add(new THREE.BoxGeometry(0.04, 0.42, 0.34), [0, 0.22, -0.48], [0, 0, 0]);
      const engine = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), glow(0x7fe8ff, 5));
      engine.position.set(0, 0, -0.66);
      ship.add(engine);
      ship.position.y = 2.0;
      ship.scale.setScalar(1.15);
      g.add(ship);
      updates.push((t) => {
        ship.rotation.y = t * 0.5;
        ship.position.y = 2.0 + Math.sin(t * 1.3) * 0.12;
        ship.rotation.z = Math.sin(t * 0.9) * 0.12;
        // Hologram flicker: mostly steady, with brief dips.
        const flicker = Math.sin(t * 37) > 0.97 ? 0.2 : 1;
        holoMat.opacity = 0.42 * flicker;
        wireMat.opacity = 0.6 * flicker;
      });
      break;
    }
    case "library": {
      // Data Core: a slowly turning cluster of glowing crystals.
      const cg = new THREE.Group();
      const mat = std({
        color: 0xb8ffd9,
        emissive: tint,
        emissiveIntensity: 1.6,
        roughness: 0.12,
        metalness: 0.2,
        transparent: true,
        opacity: 0.92,
      });
      const octa = new THREE.OctahedronGeometry(1, 0);
      for (const [x, h, z, w] of [
        [0, 2.4, 0, 0.55],
        [0.7, 1.4, 0.2, 0.32],
        [-0.6, 1.2, -0.25, 0.34],
        [0.2, 1.0, -0.7, 0.26],
        [-0.3, 1.1, 0.6, 0.24],
      ] as const) {
        const c = new THREE.Mesh(octa, mat);
        c.scale.set(w, h, w);
        c.position.set(x, h * 0.8, z);
        cg.add(c);
      }
      g.add(cg);
      updates.push((t) => {
        cg.rotation.y = t * 0.15;
        cg.position.y = Math.sin(t * 0.9) * 0.08;
      });
      break;
    }
  }
  return { group: g, update: (t) => updates.forEach((u) => u(t)) };
}
