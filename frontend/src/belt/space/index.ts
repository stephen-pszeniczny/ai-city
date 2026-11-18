// The whole of space around the station, shared by every level of the belt:
// lighting, reflections, sky, sun, Earth, the moon, the asteroid belt and the odd
// shooting star. Day and night (SPEC section 7): at night the sun slips behind Earth,
// so the station sits in its shadow, the stars brighten and the moon comes out.
//
// Usage: const space = createSpace(scene, renderer); call space.update(t, camera) every
// frame (t in seconds) and space.dispose() when the canvas goes away. The big
// asteroids themselves are drawn by the belt components (they're buildings).
import * as THREE from "three";

import { blend } from "../dayNight";
import { LOOK } from "../look";
import { createBelt } from "./belt";
import { createEarth, EARTH_POS, type Earth } from "./earth";
import { createMoon } from "./moon";
import { ORBIT_SPEED, ORBIT_SPEED_REDUCED } from "./orbit";
import { createShootingStars } from "./shootingStars";
import { createSky, SUN_DIR } from "./sky";

export type Space = {
  /** Radians per second the belt and asteroids move (slower with reduced motion). */
  orbitSpeed: number;
  update(t: number, camera: THREE.Camera): void;
  /** Go to night or day: a slow fade, or at once (first load, reduced motion). */
  setNight(night: boolean, opts: { instant: boolean }): void;
  /** Tonight's moon: 0 new, 0.5 full. */
  setMoonPhase(phase: number): void;
  /** How far into night the scene is right now: 0 day … 1 night. */
  nightAmount(): number;
  dispose(): void;
};

/** At night the sun is straight behind Earth as seen from the station. */
const NIGHT_SUN_DIR = EARTH_POS.clone().normalize();
const SUN_DAY = 3.4;
const SUN_NIGHT = 0.15;

export function createSpace(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  { reducedMotion = false }: { reducedMotion?: boolean } = {},
): Space {
  const orbitSpeed = reducedMotion ? ORBIT_SPEED_REDUCED : ORBIT_SPEED;
  const skyTurn = reducedMotion ? 0.0004 : 0.002;
  const root = new THREE.Group();
  root.name = "space";
  scene.add(root);
  scene.background = new THREE.Color(0x000000);

  // Light: the sun, a blue glow from Earth below, and a soft fill.
  const sun = new THREE.DirectionalLight(0xfff1dc, SUN_DAY);
  sun.position.copy(SUN_DIR).multiplyScalar(60);
  const earthshine = new THREE.HemisphereLight(0x0b1124, 0x2a4fa8, 0.75);
  const fill = new THREE.DirectionalLight(0x9fb6ff, 0.55);
  fill.position.set(40, 25, 60);
  root.add(sun, earthshine, fill);

  // Reflections on metal: dark space above, blue Earth below, the sun as a hot spot.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envGeo = new THREE.SphereGeometry(10, 64, 32);
  const envUniforms = { sunDir: { value: SUN_DIR }, sunAmount: { value: 1 } };
  const envMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: envUniforms,
    vertexShader:
      "varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform vec3 sunDir; uniform float sunAmount; varying vec3 vDir;
      void main(){ vec3 d = normalize(vDir); float earth = smoothstep(0.05, -0.55, d.y);
        vec3 col = mix(vec3(0.004, 0.006, 0.014), vec3(0.06, 0.16, 0.42), earth);
        float s = max(dot(d, sunDir), 0.0);
        col += vec3(1.0, 0.94, 0.84) * (pow(s, 600.0) * 80.0 + pow(s, 10.0) * 0.5) * sunAmount;
        gl_FragColor = vec4(col, 1.0); }`,
  });
  envScene.add(new THREE.Mesh(envGeo, envMat));
  const envTarget = pmrem.fromScene(envScene, 0.02);
  // Night reflections: the same, minus the sun.
  envUniforms.sunAmount.value = 0;
  const envNight = pmrem.fromScene(envScene, 0.02);
  scene.environment = envTarget.texture;

  const sky = createSky(renderer.getPixelRatio());
  const belt = createBelt();
  root.add(sky.far, sky.sun, belt.group);
  const meteors = createShootingStars(root, { reducedMotion });
  const moon = createMoon();
  root.add(moon.group);

  // The fade: from `fromAmount` towards `toAmount`, starting at the next frame.
  let fromAmount = 0;
  let toAmount = 0;
  let amount = 0;
  let fadeStart: number | null = null;
  let fadeSeconds = 0;
  let lastT = 0;
  const sunDir = new THREE.Vector3();
  const apply = (a: number) => {
    sunDir.copy(SUN_DIR).lerp(NIGHT_SUN_DIR, a).normalize();
    sun.position.copy(sunDir).multiplyScalar(60);
    sun.intensity = SUN_DAY + (SUN_NIGHT - SUN_DAY) * a;
    earth?.setSunDir(sunDir);
    sky.setNight(a);
    moon.setVisible(a);
    const env = a < 0.5 ? envTarget.texture : envNight.texture;
    if (scene.environment !== env) scene.environment = env;
  };

  // Earth takes a moment to build the first time (about 0.2 s measured): do it
  // just after the first frames have painted, so the scene appears straight away.
  let earth: Earth | null = null;
  let disposed = false;
  const earthTimer = window.setTimeout(() => {
    if (disposed) return;
    earth = createEarth();
    earth.setSunDir(sunDir.lengthSq() > 0 ? sunDir : SUN_DIR);
    root.add(earth.group);
  }, 60);

  return {
    orbitSpeed,
    update(t, camera) {
      lastT = t;
      if (fadeStart === null) fadeStart = t;
      const next = blend(fromAmount, toAmount, t - fadeStart, fadeSeconds);
      if (next !== amount) {
        amount = next;
        apply(amount);
      }
      sky.update(t);
      meteors.update(t, camera);
      sky.far.rotation.y = t * skyTurn; // the station turning
      belt.update(t, orbitSpeed);
      earth?.update(t);
    },
    setNight(night, { instant }) {
      const target = night ? 1 : 0;
      if (target === toAmount && !instant) return;
      fromAmount = instant ? target : amount;
      toAmount = target;
      fadeSeconds = instant ? 0 : LOOK.dayNight.fadeSeconds;
      fadeStart = instant ? lastT : null;
      if (instant) {
        amount = target;
        apply(amount);
      }
    },
    setMoonPhase(phase) {
      moon.setPhase(phase);
    },
    nightAmount: () => amount,
    dispose() {
      disposed = true;
      window.clearTimeout(earthTimer);
      scene.remove(root);
      if (scene.environment === envTarget.texture || scene.environment === envNight.texture)
        scene.environment = null;
      sky.dispose();
      belt.dispose();
      meteors.dispose();
      earth?.dispose();
      envTarget.dispose();
      envNight.dispose();
      moon.dispose();
      envGeo.dispose();
      envMat.dispose();
      pmrem.dispose();
    },
  };
}

export { ASTEROIDS, ORBIT_R, orbitPosition } from "./orbit";
export { rockGeometry } from "./rock";
export { softGlow } from "./noise";
