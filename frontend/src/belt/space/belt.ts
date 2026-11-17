// The asteroid belt between the big asteroids: hundreds of small tumbling
// rocks and a band of glowing dust, all orbiting with the buildings.
import * as THREE from "three";

import { noiseTexture } from "./noise";
import { pebbleGeometry } from "./rock";
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
  // Four different rock shapes, so the belt doesn't look like copies of one stone.
  const SHAPES = 4;
  const rockGeos = Array.from({ length: SHAPES }, (_, k) => pebbleGeometry(k * 3.3 + 1.7, 2));
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.95,
    metalness: 0.05,
    bumpMap: bump,
    bumpScale: 1.4,
    flatShading: true,
  });
  const perShape = Math.ceil(count / SHAPES);
  const meshes = rockGeos.map((geo) => {
    const m = new THREE.InstancedMesh(geo, rockMat, perShape);
    m.frustumCulled = false; // instances move every frame
    return m;
  });
  // Colour variety: greys, browns and the odd reddish or bluish stone.
  const palette = [0x5b5652, 0x6b6159, 0x4a4743, 0x7a6a5c, 0x5c5f66, 0x6e5348].map(
    (h) => new THREE.Color(h),
  );
  const tmpC = new THREE.Color();
  for (let i = 0; i < perShape * SHAPES; i++) {
    const m = meshes[i % SHAPES]!;
    tmpC.copy(palette[i % palette.length]!).multiplyScalar(0.8 + Math.random() * 0.45);
    m.setColorAt(Math.floor(i / SHAPES), tmpC);
  }
  const rocks: Rock[] = [];
  for (let i = 0; i < perShape * SHAPES; i++) {
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
  meshes.forEach((m) => group.add(m));

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
        meshes[i % SHAPES]!.setMatrixAt(Math.floor(i / SHAPES), m);
      }
      meshes.forEach((x) => (x.instanceMatrix.needsUpdate = true));
      dust.rotation.y = t * speed;
    },
    dispose() {
      [bump, ...rockGeos, rockMat, dustGeo, dustMat].forEach((d) => d.dispose());
      meshes.forEach((x) => x.dispose());
    },
  };
}
