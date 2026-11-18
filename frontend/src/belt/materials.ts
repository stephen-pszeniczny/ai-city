// Shared materials, textures and blinking lights for the station and asteroids.
// Made once per canvas through createKit(); dispose() frees them all.
import * as THREE from "three";

import { LOOK } from "./look";
import { context2d, makeCanvas, noiseTexture, softGlow } from "./space/noise";

type Blinker = {
  mesh: THREE.Mesh;
  halo: THREE.Sprite;
  period: number;
  offset: number;
  double: boolean;
};

export type Kit = ReturnType<typeof createKit>;

/** The station's window glow by day; night multiplies it by LOOK.dayNight.stationLightGlow. */
const WINDOW_GLOW = 1.6;

export function createKit() {
  const owned: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(x: T): T => {
    owned.push(x);
    return x;
  };

  const panel = keep(hullPanelTexture());
  const foilBump = keep(noiseTexture(256, 18, 1.6));
  const solarTex = keep(solarTexture());

  const std = (o: THREE.MeshStandardMaterialParameters) => keep(new THREE.MeshStandardMaterial(o));
  const mats = {
    hull: std({
      map: panel,
      bumpMap: panel,
      bumpScale: 0.6,
      color: 0xf1f4f8,
      roughness: 0.42,
      metalness: 0.3,
    }),
    gold: std({ color: 0xd19a35, roughness: 0.3, metalness: 1, bumpMap: foilBump, bumpScale: 2.2 }),
    darkMetal: std({ color: 0x2b313c, roughness: 0.45, metalness: 0.85 }),
    steel: std({ color: 0x9aa3b2, roughness: 0.35, metalness: 0.9 }),
    solar: std({
      map: solarTex,
      roughness: 0.22,
      metalness: 0.65,
      emissive: 0x0a1a55,
      emissiveIntensity: 0.3,
    }),
    radiator: std({ color: 0xf6f7fa, roughness: 0.25, metalness: 0.1 }),
    window: std({ color: 0x111111, emissive: 0xffc77a, emissiveIntensity: WINDOW_GLOW }),
  };

  /** A flat glowing colour (bright enough to bloom). */
  const glowCache = new Map<string, THREE.MeshBasicMaterial>();
  const glow = (hex: THREE.ColorRepresentation, k: number) => {
    const key = `${new THREE.Color(hex).getHexString()}:${k}`;
    let m = glowCache.get(key);
    if (!m) {
      m = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(k) }));
      glowCache.set(key, m);
    }
    return m;
  };

  const blinkers: Blinker[] = [];
  const blinkGeo = keep(new THREE.SphereGeometry(1, 12, 8));
  /** A navigation light that flashes (optionally twice) every `period` seconds. */
  const addBlinker = (
    parent: THREE.Object3D,
    pos: THREE.Vector3,
    hex: THREE.ColorRepresentation,
    period: number,
    offset: number,
    { double = false, size = 0.18 } = {},
  ) => {
    const mesh = new THREE.Mesh(blinkGeo, glow(hex, 6));
    mesh.scale.setScalar(size);
    mesh.position.copy(pos);
    const halo = new THREE.Sprite(
      keep(
        new THREE.SpriteMaterial({
          map: softGlow(),
          color: new THREE.Color(hex).multiplyScalar(3),
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
        }),
      ),
    );
    halo.scale.setScalar(size * 14);
    halo.position.copy(pos);
    parent.add(mesh, halo);
    blinkers.push({ mesh, halo, period, offset, double });
  };

  return {
    mats,
    glow,
    keep,
    addBlinker,
    /** 0 day … 1 night: the station's windows glow brighter in Earth's shadow. */
    setStationLights(amount: number) {
      mats.window.emissiveIntensity =
        WINDOW_GLOW * (1 + (LOOK.dayNight.stationLightGlow - 1) * amount);
    },
    updateBlinkers(t: number) {
      for (const b of blinkers) {
        const ph = ((t + b.offset) % b.period) / b.period;
        const on = ph < 0.08 || (b.double && ph > 0.16 && ph < 0.22);
        b.mesh.visible = on;
        (b.halo.material as THREE.SpriteMaterial).opacity = on ? 1 : 0.06;
      }
    },
    dispose() {
      owned.forEach((o) => o.dispose());
    },
  };
}

/** Light hull plating with panel seams and rivets. */
function hullPanelTexture(): THREE.CanvasTexture {
  const s = 512;
  const c = makeCanvas(s, s);
  const g = context2d(c);
  g.fillStyle = "#d9dee6";
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 90; i++) {
    const shade = 200 + Math.floor(Math.random() * 40);
    g.fillStyle = `rgb(${shade},${shade + 3},${shade + 8})`;
    const w = 32 * (1 + Math.floor(Math.random() * 3));
    const h = 32 * (1 + Math.floor(Math.random() * 2));
    g.fillRect(Math.floor(Math.random() * 16) * 32, Math.floor(Math.random() * 16) * 32, w, h);
  }
  g.strokeStyle = "rgba(70,78,92,0.55)";
  g.lineWidth = 2;
  for (let i = 0; i <= s; i += 64) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, s);
    g.stroke();
    g.beginPath();
    g.moveTo(0, i);
    g.lineTo(s, i);
    g.stroke();
  }
  g.fillStyle = "rgba(60,66,80,0.6)";
  for (let x = 8; x < s; x += 64) {
    for (let y = 8; y < s; y += 64) {
      g.fillRect(x, y, 3, 3);
      g.fillRect(x + 48, y + 48, 3, 3);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Blue solar cells in a light frame. */
function solarTexture(): THREE.CanvasTexture {
  const c = makeCanvas(256, 512);
  const g = context2d(c);
  g.fillStyle = "#c7ccd6";
  g.fillRect(0, 0, 256, 512);
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 16; y++) {
      const v = 30 + Math.random() * 18;
      g.fillStyle = `rgb(${v * 0.5},${v * 0.9},${v * 2.6 + 30})`;
      g.fillRect(x * 32 + 2, y * 32 + 2, 28, 28);
      g.fillStyle = "rgba(160,190,255,0.12)";
      g.fillRect(x * 32 + 2, y * 32 + 2, 28, 10);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
