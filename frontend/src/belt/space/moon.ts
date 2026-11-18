// The moon: only out at night, drawn in tonight's real phase (worked out by the
// backend from the date). It sits far off in the sky, upper right of the belt's
// home view, well away from Earth below.
import * as THREE from "three";

import { LOOK } from "../look";
import { noiseTexture, softGlow } from "./noise";

/** Direction of the moon from the station (scene units, normalised). */
export const MOON_DIR = new THREE.Vector3(0.31, -0.09, -0.946).normalize();
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

  const surface = noiseTexture(256, 5, 1.4);
  const uniforms = {
    map: { value: surface },
    phaseAngle: { value: Math.PI }, // full until told otherwise
    amount: { value: 0 },
  };
  const geo = new THREE.SphereGeometry(RADIUS, 64, 48);
  const mat = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: `varying vec2 vUv; varying vec3 vNV;
      void main(){ vUv = uv; vNV = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    // The light comes from behind the moon at new moon and from the viewer at full,
    // swinging round from one side: the lit part grows and shrinks like the real one.
    fragmentShader: `uniform sampler2D map; uniform float phaseAngle; uniform float amount;
      varying vec2 vUv; varying vec3 vNV;
      void main(){ vec3 light = vec3(sin(phaseAngle), 0.0, -cos(phaseAngle));
        float lit = smoothstep(-0.04, 0.08, dot(normalize(vNV), light));
        float tone = 0.62 + 0.38 * texture2D(map, vUv).r; // darker seas, lighter highlands
        vec3 col = vec3(0.93, 0.92, 0.88) * tone * (lit + 0.025);
        gl_FragColor = vec4(col * 1.4, amount); }`,
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
      group.visible = a > 0.001;
      uniforms.amount.value = a;
      haloMat.opacity = a * 0.35 * litFraction;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
      haloMat.dispose();
      surface.dispose();
    },
  };
}
