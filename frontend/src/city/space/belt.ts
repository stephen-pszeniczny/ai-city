// The asteroid belt between the big asteroids: hundreds of small tumbling
// rocks and a band of glowing dust, all orbiting with the buildings.
import * as THREE from "three";

import { noiseTexture } from "./noise";
import { ORBIT_R } from "./orbit";

type Rock = {
  a: number;
  r: number;
  y: number;
  s: number;
  spin: THREE.Vector3;
  sp: number;
  rot: number;
};

export type Belt = {
  group: THREE.Group;
  update(t: number, speed: number): void;
  dispose(): void;
};

export function createBelt(count = 900): Belt {
  const group = new THREE.Group();
  const bump = noiseTexture(256, 10, 1.2);
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x5b5652,
    roughness: 0.95,
    metalness: 0.05,
    bumpMap: bump,
    bumpScale: 1,
  });
  const mesh = new THREE.InstancedMesh(rockGeo, rockMat, count);
  mesh.frustumCulled = false; // instances move every frame
  const rocks: Rock[] = [];
  for (let i = 0; i < count; i++) {
    const g = Math.random() + Math.random() + Math.random() - 1.5; // denser in the middle
    rocks.push({
      a: Math.random() * Math.PI * 2,
      r: ORBIT_R + g * 5,
      y: (Math.random() - 0.5) * 1.6 * (1 - Math.abs(g) / 1.5),
      s: Math.pow(Math.random(), 3) * 0.55 + 0.05,
      spin: new THREE.Vector3(Math.random(), Math.random(), Math.random()).normalize(),
      sp: Math.random() * 1.5,
      rot: Math.random() * 6,
    });
  }
  group.add(mesh);

  const n = 5000;
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = ORBIT_R + (Math.random() + Math.random() - 1) * 6;
    pos.set([Math.cos(a) * r, (Math.random() - 0.5) * 1.2, Math.sin(a) * r], i * 3);
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const dustMat = new THREE.PointsMaterial({
    color: 0x9fb4ff,
    size: 0.09,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  group.add(dust);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  return {
    group,
    update(t, speed) {
      for (let i = 0; i < rocks.length; i++) {
        const d = rocks[i]!;
        const ang = d.a + t * speed;
        p.set(Math.cos(ang) * d.r, d.y, Math.sin(ang) * d.r);
        q.setFromAxisAngle(d.spin, d.rot + t * d.sp);
        s.setScalar(d.s);
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
      dust.rotation.y = t * speed;
    },
    dispose() {
      [bump, rockGeo, rockMat, dustGeo, dustMat].forEach((d) => d.dispose());
      mesh.dispose();
    },
  };
}
