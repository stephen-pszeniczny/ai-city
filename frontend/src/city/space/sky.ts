// The far sky: stars (twinkling), the Milky Way band, coloured nebulae and the sun.
import * as THREE from "three";

import { context2d, fbm, makeCanvas, softGlow } from "./noise";

/** Direction of the sun (also used for lighting and Earth's day side). */
export const SUN_DIR = new THREE.Vector3(-0.36, 0.16, -0.92).normalize();

export type Sky = {
  /** Stars, Milky Way and nebulae: turns slowly as the station spins. */
  far: THREE.Group;
  /** The sun stays put (it lights the scene). */
  sun: THREE.Group;
  update(t: number): void;
  dispose(): void;
};

export function createSky(pixelRatio: number): Sky {
  const far = new THREE.Group();
  const sun = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const uniforms = {
    time: { value: 0 },
    bright: { value: 0.75 },
    pixelRatio: { value: pixelRatio },
  };

  const starField = (count: number, band: boolean): THREE.Points => {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const size = new Float32Array(count);
    const phase = new Float32Array(count);
    const bandNormal = new THREE.Vector3(0.35, 0.8, -0.48).normalize();
    const u = new THREE.Vector3(1, 0, 0).cross(bandNormal).normalize();
    const v = bandNormal.clone().cross(u);
    const p = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      if (band) {
        const a = Math.random() * Math.PI * 2;
        const off = (Math.random() + Math.random() + Math.random() - 1.5) * 0.18;
        p.copy(u)
          .multiplyScalar(Math.cos(a))
          .addScaledVector(v, Math.sin(a))
          .addScaledVector(bandNormal, off)
          .normalize();
      } else {
        p.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      }
      const r = 7000 + Math.random() * 2500;
      pos.set([p.x * r, p.y * r, p.z * r], i * 3);
      const t = Math.random();
      const c = t < 0.15 ? [1.0, 0.82, 0.65] : t < 0.55 ? [1, 0.97, 0.94] : [0.75, 0.85, 1.0];
      const b = band
        ? 0.35 + Math.random() * 0.4
        : Math.random() < 0.03
          ? 2.4
          : 0.6 + Math.random() * 0.7;
      col.set([c[0]! * b, c[1]! * b, c[2]! * b], i * 3);
      size[i] = band ? 1.2 + Math.random() * 1.2 : b > 2 ? 4.5 : 1.4 + Math.random() * 2.2;
      phase[i] = Math.random();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.setAttribute("size", new THREE.BufferAttribute(size, 1));
    g.setAttribute("phase", new THREE.BufferAttribute(phase, 1));
    const m = new THREE.ShaderMaterial({
      uniforms,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      vertexShader: `attribute float size; attribute float phase; uniform float time; uniform float bright; uniform float pixelRatio;
        varying vec3 vColor; varying float vA;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          float tw = 0.7 + 0.3 * sin(time * (0.8 + phase * 2.5) + phase * 40.0);
          gl_PointSize = size * pixelRatio * (0.85 + 0.3 * tw); vColor = color; vA = tw * bright; }`,
      fragmentShader: `varying vec3 vColor; varying float vA;
        void main(){ float d = length(gl_PointCoord - 0.5); float a = pow(smoothstep(0.5, 0.0, d), 1.8); gl_FragColor = vec4(vColor * vA * a, a); }`,
    });
    disposables.push(g, m);
    return new THREE.Points(g, m);
  };
  far.add(starField(9000, false), starField(26000, true));

  const cloudTexture = (seed: number): THREE.CanvasTexture => {
    const s = 256;
    const c = makeCanvas(s, s);
    const g = context2d(c);
    const img = g.createImageData(s, s);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const dx = x / s - 0.5;
        const dy = y / s - 0.5;
        const r = Math.sqrt(dx * dx + dy * dy) * 2;
        const n = fbm((x / s) * 3 + seed, (y / s) * 3, seed, 5) + 0.5;
        const a = Math.max(0, (1 - r) * n * 1.4 - 0.15);
        const i = (y * s + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.min(255, a * 255);
      }
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    disposables.push(t);
    return t;
  };
  const nebulae: [number, number][] = [
    [0x5a3cff, 0.22],
    [0x2b8cff, 0.18],
    [0xd14dff, 0.12],
    [0x2fd3c4, 0.1],
  ];
  nebulae.forEach(([color, opacity], k) => {
    const map = cloudTexture(k * 7.3 + 1);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.SpriteMaterial({
        map,
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        rotation: Math.random() * Math.PI,
      });
      disposables.push(m);
      const sp = new THREE.Sprite(m);
      const a = (k * 3 + i) * 0.62 + 2.2;
      sp.position.set(
        Math.cos(a) * 5200,
        900 + Math.sin(a * 1.7) * 1400 + i * 300,
        -4200 + Math.sin(a) * 1600,
      );
      sp.scale.setScalar(2400 + Math.random() * 2400);
      far.add(sp);
    }
  });

  const sunPos = SUN_DIR.clone().multiplyScalar(6000);
  const sprite = (k: THREE.Color, scale: number) => {
    const m = new THREE.SpriteMaterial({
      map: softGlow(),
      color: k,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });
    disposables.push(m);
    const sp = new THREE.Sprite(m);
    sp.position.copy(sunPos);
    sp.scale.setScalar(scale);
    sun.add(sp);
  };
  sprite(new THREE.Color(1, 0.96, 0.9).multiplyScalar(14), 260);
  sprite(new THREE.Color(1, 0.8, 0.6).multiplyScalar(0.75), 2400);

  return {
    far,
    sun,
    update(t) {
      uniforms.time.value = t;
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
    },
  };
}
