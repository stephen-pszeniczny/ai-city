// The whole of space around the station, shared by every level of the belt:
// lighting, reflections, sky, sun, Earth and the asteroid belt.
//
// Usage: const space = createSpace(scene, renderer); call space.update(t) every
// frame (t in seconds) and space.dispose() when the canvas goes away. The big
// asteroids themselves are drawn by the belt components (they're buildings).
import * as THREE from "three";

import { createBelt } from "./belt";
import { createEarth, type Earth } from "./earth";
import { ORBIT_SPEED, ORBIT_SPEED_REDUCED } from "./orbit";
import { createSky, SUN_DIR } from "./sky";

export type Space = {
  /** Radians per second the belt and asteroids move (slower with reduced motion). */
  orbitSpeed: number;
  update(t: number): void;
  dispose(): void;
};

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
  const sun = new THREE.DirectionalLight(0xfff1dc, 3.4);
  sun.position.copy(SUN_DIR).multiplyScalar(60);
  const earthshine = new THREE.HemisphereLight(0x0b1124, 0x2a4fa8, 0.75);
  const fill = new THREE.DirectionalLight(0x9fb6ff, 0.55);
  fill.position.set(40, 25, 60);
  root.add(sun, earthshine, fill);

  // Reflections on metal: dark space above, blue Earth below, the sun as a hot spot.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envGeo = new THREE.SphereGeometry(10, 64, 32);
  const envMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { sunDir: { value: SUN_DIR } },
    vertexShader:
      "varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform vec3 sunDir; varying vec3 vDir;
      void main(){ vec3 d = normalize(vDir); float earth = smoothstep(0.05, -0.55, d.y);
        vec3 col = mix(vec3(0.004, 0.006, 0.014), vec3(0.06, 0.16, 0.42), earth);
        float s = max(dot(d, sunDir), 0.0);
        col += vec3(1.0, 0.94, 0.84) * (pow(s, 600.0) * 80.0 + pow(s, 10.0) * 0.5);
        gl_FragColor = vec4(col, 1.0); }`,
  });
  envScene.add(new THREE.Mesh(envGeo, envMat));
  const envTarget = pmrem.fromScene(envScene, 0.02);
  scene.environment = envTarget.texture;

  const sky = createSky(renderer.getPixelRatio());
  const belt = createBelt();
  root.add(sky.far, sky.sun, belt.group);

  // Earth takes a moment to build the first time (about 0.2 s measured): do it
  // just after the first frames have painted, so the scene appears straight away.
  let earth: Earth | null = null;
  let disposed = false;
  const earthTimer = window.setTimeout(() => {
    if (disposed) return;
    earth = createEarth();
    root.add(earth.group);
  }, 60);

  return {
    orbitSpeed,
    update(t) {
      sky.update(t);
      sky.far.rotation.y = t * skyTurn; // the station turning
      belt.update(t, orbitSpeed);
      earth?.update(t);
    },
    dispose() {
      disposed = true;
      window.clearTimeout(earthTimer);
      scene.remove(root);
      if (scene.environment === envTarget.texture) scene.environment = null;
      sky.dispose();
      belt.dispose();
      earth?.dispose();
      envTarget.dispose();
      envGeo.dispose();
      envMat.dispose();
      pmrem.dispose();
    },
  };
}

export { ASTEROIDS, ORBIT_R, orbitPosition } from "./orbit";
export { rockGeometry } from "./rock";
export { softGlow } from "./noise";
