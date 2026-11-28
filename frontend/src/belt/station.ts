// The central space station: hub, spinning habitat ring, truss, solar wings,
// and the two building modules — Mission Control (white, lit window bands,
// dish) on the left and the Vault (gold foil, glowing bar chart) on the right.
import * as THREE from "three";

import type { Kit } from "./materials";

export type StationModule = "planner" | "finance";

export type Station = {
  group: THREE.Group;
  /** Where each module's label sits (local to the station, which doesn't move). */
  anchors: Record<StationModule, THREE.Vector3>;
  /** Each module's own group, centred on it: upgrades are added here (see growth/). */
  moduleAnchors: Record<StationModule, THREE.Group>;
  /** Clickable meshes, tagged with userData.buildingId. */
  pickables: THREE.Object3D[];
  update(t: number): void;
};

const cylX = (r: number, len: number, mat: THREE.Material, seg = 40) => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  m.rotation.z = Math.PI / 2;
  return m;
};

const shadowed = <T extends THREE.Object3D>(o: T): T => {
  o.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  return o;
};

const tag = (o: THREE.Object3D, id: StationModule) => {
  o.traverse((c) => (c.userData.buildingId = id));
  return o;
};

/** Ring angle (radians about x) that leaves its four spokes diagonal, clear of the hatch. */
const RING_CLEAR_ANGLE = Math.PI / 4 - 0.4;

export function createStation(kit: Kit): Station {
  const { mats, glow, addBlinker } = kit;
  const group = new THREE.Group();
  group.name = "station";

  // Truss: one instanced mesh of thin rods.
  {
    const rodGeo = new THREE.CylinderGeometry(0.07, 0.07, 1, 6);
    const rods: [THREE.Vector3, THREE.Vector3][] = [];
    for (const [y, z] of [
      [0.45, 0.45],
      [0.45, -0.45],
      [-0.45, 0.45],
      [-0.45, -0.45],
    ] as const) {
      rods.push([new THREE.Vector3(-17, y, z), new THREE.Vector3(17, y, z)]);
    }
    for (let x = -16.8; x <= 16.8; x += 1.2) {
      rods.push([new THREE.Vector3(x, 0.45, 0.45), new THREE.Vector3(x + 1.2, -0.45, 0.45)]);
      rods.push([new THREE.Vector3(x, 0.45, -0.45), new THREE.Vector3(x + 1.2, -0.45, -0.45)]);
      rods.push([new THREE.Vector3(x, 0.45, 0.45), new THREE.Vector3(x, 0.45, -0.45)]);
      rods.push([new THREE.Vector3(x, -0.45, 0.45), new THREE.Vector3(x + 1.2, -0.45, -0.45)]);
    }
    const inst = new THREE.InstancedMesh(rodGeo, mats.steel, rods.length);
    const up = new THREE.Vector3(0, 1, 0);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    rods.forEach(([a, b], i) => {
      const d = b.clone().sub(a);
      const len = d.length();
      q.setFromUnitVectors(up, d.normalize());
      m.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, len, 1));
      inst.setMatrixAt(i, m);
    });
    group.add(shadowed(inst));
  }

  // Hub and spinning habitat ring.
  const ring = new THREE.Group();
  // Inside of the open hatch: dark, so the switch to the station's inside view happens
  // unseen while the camera is in the tunnel.
  const hatchMaterial = kit.keep(
    new THREE.MeshStandardMaterial({
      color: 0x9aa7c4,
      roughness: 0.5,
      metalness: 0.4,
      side: THREE.DoubleSide,
    }),
  );
  {
    group.add(shadowed(new THREE.Mesh(new THREE.SphereGeometry(2.0, 48, 32), mats.hull)));
    for (const [x, y, z] of [
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ] as const) {
      // The front port is the hatch you fly in through: open-ended, with a dark tunnel
      // inside, so the camera visibly enters an opening rather than a closed door.
      const front = z === 1;
      const port = new THREE.Mesh(
        new THREE.CylinderGeometry(0.75, 0.75, 1.3, 32, 1, front),
        front ? hatchMaterial : mats.hull,
      );
      port.position.set(x * 2.3, y * 2.3, z * 2.3);
      if (z) port.rotation.x = Math.PI / 2;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.08, 8, 32), mats.darkMetal);
      rim.position.copy(port.position).multiplyScalar(1.28);
      if (!z) rim.rotation.x = Math.PI / 2;
      group.add(shadowed(port), shadowed(rim));
      if (front) {
        // The tunnel's far end: dark, like looking into the station from outside.
        const end = new THREE.Mesh(
          kit.keep(new THREE.CircleGeometry(0.74, 32)),
          kit.keep(new THREE.MeshBasicMaterial({ color: 0x05070d })),
        );
        end.position.set(0, 0, 1.9);
        group.add(end);
      }
    }
    const torus = new THREE.Mesh(new THREE.TorusGeometry(6.6, 0.62, 28, 160), mats.hull);
    torus.rotation.y = Math.PI / 2;
    ring.add(torus);
    for (let i = 0; i < 4; i++) {
      const spoke = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 4.6, 12), mats.steel);
      const a = (i / 4) * Math.PI * 2 + 0.4;
      spoke.position.set(0, Math.cos(a) * 4.3, Math.sin(a) * 4.3);
      spoke.rotation.x = -a;
      ring.add(spoke);
    }
    const wins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.16, 0.06), mats.window, 96);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let i = 0; i < 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      e.set(-a, 0, 0);
      q.setFromEuler(e);
      m.compose(
        new THREE.Vector3(i % 2 ? 0.34 : -0.34, Math.cos(a) * 7.2, Math.sin(a) * 7.2),
        q,
        new THREE.Vector3(1, 1, 1),
      );
      wins.setMatrixAt(i, m);
    }
    ring.add(wins);
    group.add(shadowed(ring));
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4.2, 6), mats.steel);
    mast.position.set(0, 5.3, 0);
    group.add(mast);
    addBlinker(group, new THREE.Vector3(0, 7.5, 0), 0xff3b30, 1.6, 0);
  }

  // Pressurised hallways joining the hub to both modules, with a row of lit
  // windows, and a glowing ring round the hub's hatch (where you fly in).
  {
    for (const s of [-1, 1]) {
      const tube = cylX(0.85, 4.6, mats.hull, 32);
      tube.position.x = s * 4.3;
      group.add(shadowed(tube));
      for (const x of [2.3, 6.3]) {
        const collar = new THREE.Mesh(new THREE.TorusGeometry(0.88, 0.07, 8, 32), mats.darkMetal);
        collar.rotation.y = Math.PI / 2;
        collar.position.x = s * x;
        group.add(collar);
      }
      const wins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.3, 0.16, 0.05), mats.window, 7);
      const m = new THREE.Matrix4();
      for (let i = 0; i < 7; i++) {
        m.makeTranslation(s * (2.7 + i * 0.55), 0.15, -0.85);
        wins.setMatrixAt(i, m);
      }
      group.add(wins);
    }
    const hatch = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.05, 8, 40), glow(0x4169e1, 2.2));
    hatch.position.set(0, 0, 2.97);
    group.add(hatch);
  }

  // Mission Control module: white, with lit window bands and a dish.
  const planner = new THREE.Group();
  {
    planner.position.x = -10.5;
    planner.add(cylX(2.15, 8, mats.hull, 48));
    for (const s of [-1, 1]) {
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(2.15, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2),
        mats.hull,
      );
      cap.rotation.z = (-s * Math.PI) / 2;
      cap.scale.y = 0.45;
      cap.position.x = s * 4;
      planner.add(cap);
    }
    for (const x of [-3.1, -2.4, 1.2, 1.9]) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(2.17, 0.06, 6, 64), mats.darkMetal);
      band.rotation.y = Math.PI / 2;
      band.position.x = x;
      planner.add(band);
    }
    const wins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.34, 0.24, 0.05), mats.window, 72);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    let k = 0;
    for (const x of [-1.6, -0.6, 0.4]) {
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        e.set(-a, 0, 0);
        q.setFromEuler(e);
        m.compose(
          new THREE.Vector3(x, Math.cos(a) * 2.17, Math.sin(a) * 2.17),
          q,
          new THREE.Vector3(1, 1, 1),
        );
        wins.setMatrixAt(k++, m);
      }
    }
    planner.add(wins);
    const dish = new THREE.Mesh(
      new THREE.LatheGeometry(
        [0, 0.3, 0.6, 0.9, 1.1].map((x) => new THREE.Vector2(x, x * x * 0.35)),
        32,
      ),
      mats.radiator,
    );
    dish.position.set(1.5, 3.1, 0);
    dish.rotation.set(0.5, 0, -0.4);
    const dishMast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 6), mats.steel);
    dishMast.position.set(1.5, 2.5, 0);
    planner.add(dish, dishMast);
    group.add(tag(shadowed(planner), "planner"));
    addBlinker(group, new THREE.Vector3(-15.4, 0, 0), 0xff2d2d, 2.2, 0.3);
  }

  // The Vault module: gold foil and a glowing bar chart.
  const finance = new THREE.Group();
  {
    finance.position.x = 10.5;
    const body = cylX(2.25, 7.6, mats.gold, 8);
    body.rotation.x = Math.PI / 8;
    finance.add(body);
    for (const s of [-1, 1]) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(2.0, 2.3, 0.5, 8), mats.darkMetal);
      r.rotation.z = Math.PI / 2;
      r.rotation.x = Math.PI / 8;
      r.position.x = s * 4;
      finance.add(r);
    }
    [0.5, 0.8, 0.7, 1.15, 1.4, 1.9].forEach((h, i) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.42, h, 0.12), glow(0xffc24a, 2.4));
      bar.position.set(-2.2 + i * 0.75, -0.6 + h / 2, 2.12);
      finance.add(bar);
    });
    for (const s of [-1, 1]) {
      const rad = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.05, 2.2), mats.radiator);
      rad.position.set(0, s * 3.3, 0);
      rad.rotation.x = s * 0.25;
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 6), mats.steel);
      strut.position.set(0, s * 2.7, 0);
      finance.add(rad, strut);
    }
    group.add(tag(shadowed(finance), "finance"));
    addBlinker(group, new THREE.Vector3(15.4, 0, 0), 0x30ff6a, 2.2, 0.3);
  }

  // Solar wings at both ends.
  const wings: THREE.Group[] = [];
  for (const sx of [-17.2, 17.2]) {
    const pivot = new THREE.Group();
    pivot.position.x = sx;
    for (const sz of [-1, 1]) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.05, 11), mats.solar);
      panel.position.z = sz * 6.8;
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 12.6), mats.steel);
      frame.position.z = sz * 6.6;
      pivot.add(panel, frame);
      addBlinker(pivot, new THREE.Vector3(0, 0.15, sz * 12.4), 0xffffff, 1.3, sz > 0 ? 0 : 0.15, {
        double: true,
        size: 0.12,
      });
    }
    const mount = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.6, 16), mats.darkMetal);
    mount.rotation.z = Math.PI / 2;
    pivot.add(mount);
    group.add(shadowed(pivot));
    wings.push(pivot);
  }

  return {
    group,
    anchors: {
      planner: new THREE.Vector3(-10.5, 3.2, 0),
      finance: new THREE.Vector3(10.5, 4.0, 0),
    },
    moduleAnchors: { planner, finance },
    pickables: [planner, finance],
    update(t) {
      // The ring holds still at an angle where its spokes are diagonal, clear of the
      // hatch's line of approach (a spinning ring could put a spoke in the camera's way).
      ring.rotation.x = RING_CLEAR_ANGLE;
      wings.forEach((w) => (w.rotation.x = Math.sin(t * 0.05) * 0.25 + 0.2));
    },
  };
}
