// Small maths and texture helpers shared by the space scene.
import * as THREE from "three";
import { ImprovedNoise } from "three/addons/math/ImprovedNoise.js";

export const perlin = new ImprovedNoise();

/** Fractal noise: several octaves of Perlin noise added together. */
export function fbm(x: number, y: number, z: number, octaves = 5): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * perlin.noise(x * freq, y * freq, z * freq);
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum;
}

export const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

export function context2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const g = c.getContext("2d");
  if (!g) throw new Error("This browser can't draw 2D canvases.");
  return g;
}

let softGlowTex: THREE.CanvasTexture | null = null;

/** A soft round glow, used for halos, the sun and blinking lights. Made once. */
export function softGlow(): THREE.CanvasTexture {
  if (softGlowTex) return softGlowTex;
  const c = makeCanvas(256, 256);
  const g = context2d(c);
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.15, "rgba(255,255,255,0.6)");
  grad.addColorStop(0.45, "rgba(255,255,255,0.12)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  softGlowTex = new THREE.CanvasTexture(c);
  softGlowTex.colorSpace = THREE.SRGBColorSpace;
  return softGlowTex;
}

/** Grey noise for bump maps (rock surfaces). */
export function noiseTexture(size: number, scale: number, contrast = 1): THREE.CanvasTexture {
  const c = makeCanvas(size, size);
  const g = context2d(c);
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm((x / size) * scale, (y / size) * scale, 0.5, 4);
      const v = Math.max(0, Math.min(255, 128 + n * 255 * contrast));
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
