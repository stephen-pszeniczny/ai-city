// The moon's surface, made once per session: dark smooth "seas", lighter highlands
// and a scatter of craters (dark floors, bright raised rims, rays from a few young
// ones). Two maps: colour (albedo) and height, which the moon's shader turns into
// small shadows along the line between its lit and dark sides.
//
// Both maps wrap left to right without a seam, and the layout is the same every
// time (a fixed seed), so the moon looks like the same moon each night.
import * as THREE from "three";

import { context2d, fbm, makeCanvas, smooth } from "./noise";

const W = 512;
const H = 256;
const CRATERS = 220;
const RAYED = 3; // the biggest few young craters get bright rays

export type MoonSurface = { albedo: THREE.CanvasTexture; height: THREE.CanvasTexture };

let cached: MoonSurface | null = null;

/** A small seeded random generator (mulberry32), so the moon is the same every time. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function moonSurface(): MoonSurface {
  if (cached) return cached;
  const t0 = performance.now();
  const rand = seeded(1969);
  const albedo = new Float32Array(W * H);
  const height = new Float32Array(W * H);

  // Seas and highlands. Noise is sampled round a cylinder so the left and right
  // edges of the map meet without a seam.
  for (let y = 0; y < H; y++) {
    const v = y / H;
    for (let x = 0; x < W; x++) {
      const a = (x / W) * Math.PI * 2;
      const cx = Math.cos(a) * 1.6;
      const cz = Math.sin(a) * 1.6;
      const sea = smooth(0.02, 0.2, fbm(cx, v * 3.2, cz + 7.1, 4));
      const grain = fbm(cx * 6, v * 19, cz * 6 + 3.3, 4);
      const i = y * W + x;
      albedo[i] = 0.8 - 0.36 * sea + grain * 0.09;
      height[i] = -0.25 * sea + grain * 0.12;
    }
  }

  // Craters: mostly small, a few big (sizes follow a power law, like the real moon).
  type Crater = { x: number; y: number; r: number };
  const craters: Crater[] = [];
  for (let k = 0; k < CRATERS; k++) {
    const r = 1.3 + 16 * Math.pow(rand(), 3.2);
    // Keep away from the poles, where the map is stretched most.
    const y = H * (0.12 + 0.76 * rand());
    craters.push({ x: rand() * W, y, r });
  }
  craters.sort((p, q) => q.r - p.r);

  for (const c of craters) {
    // The map is stretched sideways away from the equator; widen craters to match.
    const lat = (c.y / H - 0.5) * Math.PI;
    const sx = 1 / Math.max(0.25, Math.cos(lat));
    const reach = c.r * 1.5;
    for (let dy = -reach; dy <= reach; dy++) {
      const y = Math.round(c.y + dy);
      if (y < 0 || y >= H) continue;
      for (let dx = -reach * sx; dx <= reach * sx; dx++) {
        const d = Math.hypot(dx / sx, dy) / c.r;
        if (d > 1.5) continue;
        const x = ((Math.round(c.x + dx) % W) + W) % W;
        const i = y * W + x;
        const bowl = d < 1 ? -(1 - d * d) * 0.9 : 0;
        const rim = Math.exp(-(((d - 1) / 0.16) ** 2)) * 0.35;
        height[i] = (height[i] ?? 0) + (bowl + rim) * Math.min(1, c.r / 4);
        albedo[i] = (albedo[i] ?? 0) + (d < 0.8 ? -0.07 : rim * 0.3);
      }
    }
  }

  // Bright rays from the biggest few, fading with distance.
  for (const c of craters.slice(0, RAYED)) {
    const rays = 9 + Math.floor(rand() * 6);
    for (let k = 0; k < rays; k++) {
      const ang = rand() * Math.PI * 2;
      const len = c.r * (3 + rand() * 4);
      for (let s = c.r; s < len; s += 0.5) {
        const fade = 1 - s / len;
        const x = ((Math.round(c.x + Math.cos(ang) * s * 1.2) % W) + W) % W;
        const y = Math.round(c.y + Math.sin(ang) * s * 0.6);
        if (y < 0 || y >= H) continue;
        for (const o of [-1, 0, 1]) {
          const i = Math.min(H - 1, Math.max(0, y + o)) * W + x;
          albedo[i] = (albedo[i] ?? 0) + 0.06 * fade * (o === 0 ? 1 : 0.5);
        }
      }
    }
  }

  const toTexture = (data: Float32Array, lo: number, hi: number, colour: boolean) => {
    const c = makeCanvas(W, H);
    const g = context2d(c);
    const img = g.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const v = Math.round(255 * Math.min(1, Math.max(0, (data[i]! - lo) / (hi - lo))));
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = v;
      img.data[i * 4 + 2] = colour ? Math.round(v * 0.96) : v; // a touch warm
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    if (colour) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  };
  cached = {
    albedo: toTexture(albedo, 0.2, 1.0, true),
    height: toTexture(height, -1.2, 0.6, false),
  };
  performance.measure("moon surface", { start: t0 }); // see the browser's Performance panel
  return cached;
}
