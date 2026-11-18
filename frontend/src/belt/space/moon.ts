// The moon: only out at night, drawn in tonight's real phase (worked out by the
// backend from the date). It sits far off in the sky, high on the right of the
// belt's home view (above the building signs), well away from Earth below.
import * as THREE from "three";

import { LOOK } from "../look";
import { softGlow } from "./noise";
import { moonSurface } from "./moonSurface";

/** Direction of the moon from the station (scene units, normalised). */
export const MOON_DIR = new THREE.Vector3(0.22, -0.01, -0.975).normalize();
const DISTANCE = 5200;
const RADIUS = 70; // about 1.5° across: a little bigger than the real moon, so it reads

export type Moon = {
  group: THREE.Group;
  /** 0 new, 0.5 full. */
  setPhase(p: number): void;
  /** 0 hidden (day) … 1 fully out (night). */
  setVisible(amount: number): void;
  dispose(): void;
};

export function createMoon(): Moon {
  const group = new THREE.Group();
  group.position.copy(MOON_DIR).multiplyScalar(DISTANCE);
  group.scale.setScalar(LOOK.dayNight.moonSize);

  // The surface maps are built the first time the moon comes out (not by day).
  const uniforms = {
    map: { value: null as THREE.Texture | null },
    heightMap: { value: null as THREE.Texture | null },
    bump: { value: 2.2 },
    phaseAngle: { value: Math.PI }, // full until told otherwise
    amount: { value: 0 },
  };
  const geo = new THREE.SphereGeometry(RADIUS, 64, 48);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: `varying vec2 vUv; varying vec3 vNV; varying vec3 vPV;
      void main(){ vUv = uv; vNV = normalize(normalMatrix * normal); vec4 p = modelViewMatrix * vec4(position, 1.0); vPV = p.xyz; gl_Position = projectionMatrix * p; }`,
    // The light comes from behind the moon at new moon and from the viewer at full,
    // swinging round from one side: the lit part grows and shrinks like the real one.
    // Crater heights tilt the surface a little, so near the edge of the lit part
    // rims catch the light and floors fall into shadow.
    fragmentShader: `uniform sampler2D map; uniform sampler2D heightMap; uniform float bump;
      uniform float phaseAngle; uniform float amount;
      varying vec2 vUv; varying vec3 vNV; varying vec3 vPV;
      void main(){ vec3 light = vec3(sin(phaseAngle), 0.0, -cos(phaseAngle));
        vec3 n0 = normalize(vNV);
        float hh = texture2D(heightMap, vUv).r;
        vec3 sx = dFdx(vPV); vec3 sy = dFdy(vPV);
        vec3 r1 = cross(sy, n0); vec3 r2 = cross(n0, sx);
        float det = dot(sx, r1);
        vec3 grad = sign(det) * (dFdx(hh) * r1 + dFdy(hh) * r2);
        vec3 n = normalize(abs(det) * n0 - grad * bump);
        float side = smoothstep(-0.04, 0.08, dot(n0, light));      // the phase shape
        float shade = pow(clamp(dot(n, light), 0.0, 1.0), 0.55);    // the moon looks evenly bright, not shaded like a ball
        vec3 col = texture2D(map, vUv).rgb * (side * mix(0.35, 1.0, shade) + 0.02);
        gl_FragColor = vec4(col * 1.5, amount); }`,
  });
  const ball = new THREE.Mesh(geo, mat);

  const haloMat = new THREE.SpriteMaterial({
    map: softGlow(),
    color: new THREE.Color(0.75, 0.8, 0.95),
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    opacity: 0,
  });
  const halo = new THREE.Sprite(haloMat);
  halo.scale.setScalar(RADIUS * 7);
  group.add(halo, ball);
  group.visible = false;

  let litFraction = 1;
  return {
    group,
    setPhase(p) {
      uniforms.phaseAngle.value = p * Math.PI * 2;
      litFraction = (1 - Math.cos(p * Math.PI * 2)) / 2;
    },
    setVisible(amount) {
      const a = amount * LOOK.dayNight.moonBrightness;
      if (a > 0.001 && !uniforms.map.value) {
        const surface = moonSurface();
        uniforms.map.value = surface.albedo;
        uniforms.heightMap.value = surface.height;
      }
      group.visible = a > 0.001;
      uniforms.amount.value = a;
      haloMat.opacity = a * 0.35 * litFraction;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      haloMat.dispose();
    },
  };
}
