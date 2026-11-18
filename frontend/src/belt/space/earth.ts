// Earth below the station: procedural continents with relief, oceans that
// catch the sun, city lights clustered along coasts and rivers on the night
// side, drifting clouds, a warm band at dusk and a blue atmosphere glow.
//
// The textures take a moment to make (about 0.2 s measured), so they're made once per session
// and reused (kept even when a scene is disposed).
import * as THREE from "three";

import { context2d, fbm, lerp, makeCanvas, perlin, smooth } from "./noise";
import { LOOK } from "../look";
import { SUN_DIR } from "./sky";

export const EARTH_R = 1091;
/** Where Earth sits, far below the station (scene units). */
export const EARTH_POS = new THREE.Vector3(248, -1466, -450);

type EarthTextures = {
  day: THREE.CanvasTexture;
  night: THREE.CanvasTexture;
  spec: THREE.CanvasTexture;
  clouds: THREE.CanvasTexture;
};
let cached: EarthTextures | null = null;

function earthTextures(): EarthTextures {
  if (cached) return cached;
  const t0 = performance.now();
  const W = 1536;
  const H = 768;
  const CW = W / 2;
  const CH = H / 2;
  const canvases = [0, 1, 2, 3].map((k) => (k === 3 ? makeCanvas(CW, CH) : makeCanvas(W, H)));
  const [dI, nI, sI, cI] = canvases.map((c) => context2d(c).createImageData(c.width, c.height)) as [
    ImageData,
    ImageData,
    ImageData,
    ImageData,
  ];
  for (let y = 0; y < H; y++) {
    const lat = (0.5 - (y + 0.5) / H) * Math.PI;
    const cl = Math.cos(lat);
    const sl = Math.sin(lat);
    const absLat = Math.abs(lat);
    for (let x = 0; x < W; x++) {
      const lon = ((x + 0.5) / W) * Math.PI * 2 - Math.PI;
      const px = cl * Math.cos(lon);
      const py = sl;
      const pz = cl * Math.sin(lon);
      const e = fbm(px * 1.7 + 11, py * 1.7 + 3, pz * 1.7 + 7, 5);
      const land = e > 0.045;
      const ice = absLat > 1.18 + 0.12 * perlin.noise(px * 5, py * 5, pz * 5);
      const i = (y * W + x) * 4;
      let r: number;
      let g: number;
      let b: number;
      if (ice) {
        r = 228;
        g = 236;
        b = 244;
      } else if (land) {
        const h = Math.min(1, (e - 0.045) / 0.35);
        const m = fbm(px * 4 + 40, py * 4, pz * 4 + 9, 3);
        const dry = smooth(0.0, 0.18, m) * (1 - smooth(0.35, 0.75, absLat));
        r = lerp(lerp(46, 104, h), 186, dry);
        g = lerp(lerp(78, 96, h), 158, dry);
        b = lerp(lerp(38, 64, h), 108, dry);
      } else {
        const depth = Math.min(1, (0.045 - e) * 4);
        r = lerp(22, 5, depth);
        g = lerp(78, 22, depth);
        b = lerp(122, 56, depth);
      }
      dI.data[i] = r;
      dI.data[i + 1] = g;
      dI.data[i + 2] = b;
      dI.data[i + 3] = 255;
      // R: ocean (shiny), G: land height (for relief shading in the shader).
      sI.data[i] = land || ice ? 18 : 255;
      sI.data[i + 1] = land ? 40 + Math.min(1, (e - 0.045) / 0.35) * 215 : 0;
      sI.data[i + 2] = 0;
      sI.data[i + 3] = 255;
      let lv = 0;
      if (land && !ice) {
        // Cities cluster in some regions, along coasts and along rivers.
        const temperate = 1 - smooth(0.9, 1.15, absLat);
        const region = smooth(0.0, 0.22, fbm(px * 7 + 3, py * 7, pz * 7, 3));
        const coast = 1 - smooth(0.0, 0.05, e - 0.045);
        const river = smooth(
          0.93,
          0.99,
          1 - Math.abs(perlin.noise(px * 9 + 5, py * 9, pz * 9 - 2)),
        );
        const density = temperate * (region * 0.4 + coast * (0.25 + region) * 0.6 + river * 0.45);
        const roll = Math.random();
        if (roll < density * 0.2) lv = 150 + Math.random() * 105;
        else if (roll < density * 0.55) lv = 40 + Math.random() * 50;
        else if (roll < density * 0.9) lv = 12 + Math.random() * 14;
      }
      nI.data[i] = lv;
      nI.data[i + 1] = lv * 0.72;
      nI.data[i + 2] = lv * 0.42;
      nI.data[i + 3] = 255;
      if (x % 2 === 0 && y % 2 === 0) {
        // Clouds are soft, so half resolution is plenty (and much quicker).
        const ca = smooth(0.0, 0.32, fbm(px * 2.6 + 90, py * 4.2, pz * 2.6 + 5, 5)) * 255;
        const ci = ((y / 2) * CW + x / 2) * 4;
        cI.data[ci] = cI.data[ci + 1] = cI.data[ci + 2] = ca;
        cI.data[ci + 3] = 255;
      }
    }
  }
  const tex = (k: number, img: ImageData, srgb: boolean) => {
    const c = canvases[k]!;
    const g = context2d(c);
    g.putImageData(img, 0, 0);
    if (k === 1) {
      // City lights: add a soft glow round each cluster.
      g.globalCompositeOperation = "lighter";
      g.filter = "blur(2px)";
      g.globalAlpha = 0.8;
      g.drawImage(c, 0, 0);
      g.filter = "none";
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
    }
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };
  cached = {
    day: tex(0, dI, true),
    night: tex(1, nI, true),
    spec: tex(2, sI, false),
    clouds: tex(3, cI, false),
  };
  performance.measure("earth textures", { start: t0 }); // see the browser's Performance panel
  return cached;
}

export type Earth = {
  group: THREE.Group;
  update(t: number): void;
  /** Point the sunlight (day side, clouds, atmosphere) along this direction. */
  setSunDir(dir: THREE.Vector3): void;
  dispose(): void;
};

export function createEarth(): Earth {
  const tx = earthTextures();
  const group = new THREE.Group();
  group.position.copy(EARTH_POS);
  group.rotation.set(0.25, 0, 1.2);
  const sunDir = { value: SUN_DIR.clone() };

  const surfaceGeo = new THREE.SphereGeometry(EARTH_R, 160, 120);
  const surfaceMat = new THREE.ShaderMaterial({
    uniforms: {
      dayMap: { value: tx.day },
      nightMap: { value: tx.night },
      specMap: { value: tx.spec },
      sunDir,
      cityLights: { value: LOOK.earth.cityLights },
    },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform sampler2D dayMap; uniform sampler2D nightMap; uniform sampler2D specMap; uniform vec3 sunDir; uniform float cityLights;
      varying vec2 vUv; varying vec3 vN; varying vec3 vW;
      void main(){ vec3 n = normalize(vN); vec3 v = normalize(cameraPosition - vW);
        // Relief: tilt the normal by the slope of the land height (mountains catch the light).
        float hh = texture2D(specMap, vUv).g;
        vec3 sx = dFdx(vW); vec3 sy = dFdy(vW);
        vec3 r1 = cross(sy, n); vec3 r2 = cross(n, sx);
        float det = dot(sx, r1);
        vec3 grad = sign(det) * (dFdx(hh) * r1 + dFdy(hh) * r2);
        n = normalize(abs(det) * n - grad * 14.0);
        float ndl = dot(n, sunDir); float dayAmt = smoothstep(-0.12, 0.22, ndl);
        vec3 day = texture2D(dayMap, vUv).rgb; vec3 lights = texture2D(nightMap, vUv).rgb; float ocean = texture2D(specMap, vUv).r;
        vec3 h = normalize(sunDir + v); float spec = pow(max(dot(n, h), 0.0), 70.0) * ocean * 2.2;
        vec3 col = day * max(ndl, 0.0) * 1.6 + spec * vec3(1.0, 0.88, 0.7) * step(0.0, ndl);
        col += lights * (1.0 - dayAmt) * 3.0 * cityLights;
        // A warm band where day meets night.
        col += vec3(1.0, 0.45, 0.15) * exp(-pow(ndl * 7.0, 2.0)) * 0.12;
        float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        col += vec3(0.22, 0.48, 1.0) * fres * (0.08 + 0.9 * smoothstep(-0.35, 0.4, ndl));
        gl_FragColor = vec4(col, 1.0); }`,
  });
  const surface = new THREE.Mesh(surfaceGeo, surfaceMat);

  const cloudGeo = new THREE.SphereGeometry(EARTH_R * 1.006, 160, 120);
  const cloudMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: tx.clouds }, sunDir },
    transparent: true,
    depthWrite: false,
    vertexShader:
      "varying vec2 vUv; varying vec3 vN; void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform sampler2D map; uniform vec3 sunDir; varying vec2 vUv; varying vec3 vN;
      void main(){ float a = texture2D(map, vUv).r; float lit = clamp(dot(normalize(vN), sunDir) * 1.3 + 0.05, 0.0, 1.0);
        gl_FragColor = vec4(vec3(1.0) * lit * 1.25 + vec3(0.01, 0.02, 0.05), a * 0.88); }`,
  });
  const clouds = new THREE.Mesh(cloudGeo, cloudMat);

  const atmoGeo = new THREE.SphereGeometry(EARTH_R * 1.035, 128, 96);
  const atmoMat = new THREE.ShaderMaterial({
    uniforms: { sunDir },
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader:
      "varying vec3 vNV; varying vec3 vNW; varying vec3 vCentre; void main(){ vNV = normalize(normalMatrix * normal); vNW = normalize(mat3(modelMatrix) * normal); vCentre = modelMatrix[3].xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    // When the sun is behind Earth (night), the edge of the air lights up as a warm ring.
    fragmentShader: `uniform vec3 sunDir; varying vec3 vNV; varying vec3 vNW; varying vec3 vCentre;
      void main(){ float i = pow(max(0.0, 0.68 - dot(vNV, vec3(0.0, 0.0, 1.0))), 3.2);
        float lit = 0.25 + 0.75 * smoothstep(-0.4, 0.5, dot(vNW, sunDir));
        float behind = smoothstep(0.3, 0.9, dot(normalize(vCentre - cameraPosition), sunDir));
        vec3 col = vec3(0.28, 0.56, 1.0) * i * lit * 2.4 + vec3(1.0, 0.62, 0.38) * i * behind * 2.0;
        gl_FragColor = vec4(col, 1.0); }`,
  });
  group.add(surface, clouds, new THREE.Mesh(atmoGeo, atmoMat));

  return {
    group,
    update(t) {
      surface.rotation.y = t * 0.0035;
      clouds.rotation.y = t * (0.0035 + 0.0017 * LOOK.earth.cloudSpeed);
    },
    setSunDir(dir) {
      sunDir.value.copy(dir);
    },
    dispose() {
      // Textures stay cached for the session; only per-scene pieces are freed.
      [surfaceGeo, surfaceMat, cloudGeo, cloudMat, atmoGeo, atmoMat].forEach((d) => d.dispose());
    },
  };
}
