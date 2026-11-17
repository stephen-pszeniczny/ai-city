// The occasional shooting star: a bright streak with a fading tail that
// crosses part of the sky in under a second, every 20 to 60 seconds
// (LOOK.shootingStars). Off with reduced motion.
import * as THREE from "three";

import { LOOK } from "../look";
import { mulberry32 } from "../../interior/robotBrain";
import { nextGap, shootingStarsEnabled } from "./starTiming";

const LIFE = 0.9; // seconds a streak is visible
const SHELL = 900; // distance from the station where streaks happen
const LENGTH = 140;

export type ShootingStars = { update(t: number, camera: THREE.Camera): void; dispose(): void };

export function createShootingStars(
  parent: THREE.Object3D,
  { reducedMotion }: { reducedMotion: boolean },
): ShootingStars {
  if (!shootingStarsEnabled(reducedMotion)) return { update() {}, dispose() {} };
  const rng = mulberry32(Math.floor(Math.random() * 1e9));
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(4 * 3);
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  // Head end bright, tail end clear.
  geo.setAttribute("fade", new THREE.BufferAttribute(new Float32Array([1, 1, 0, 0]), 1));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const mat = new THREE.ShaderMaterial({
    uniforms: { alpha: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `attribute float fade; varying float vFade;
      void main(){ vFade = fade; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform float alpha; varying float vFade;
      void main(){ gl_FragColor = vec4(vec3(0.85, 0.92, 1.0) * 1.6, alpha * vFade * vFade); }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  parent.add(mesh);

  let nextAt = 6 + nextGap(rng, 0, LOOK.shootingStars.minSeconds); // the first one comes sooner
  let startedAt = -1;
  const from = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const head = new THREE.Vector3();
  const tail = new THREE.Vector3();
  const toCam = new THREE.Vector3();
  const across = new THREE.Vector3();

  return {
    update(t, camera) {
      if (startedAt < 0 && t >= nextAt) {
        // Somewhere up and in front of where the camera looks, moving across and down.
        startedAt = t;
        const look = new THREE.Vector3();
        camera.getWorldDirection(look);
        const yaw = Math.atan2(look.x, look.z) + (rng() - 0.5) * 1.6;
        const up = 0.25 + rng() * 0.5;
        from
          .set(Math.sin(yaw) * Math.cos(up), Math.sin(up), Math.cos(yaw) * Math.cos(up))
          .multiplyScalar(SHELL);
        dir.set(rng() - 0.5, -0.35 - rng() * 0.3, rng() - 0.5).normalize();
      }
      if (startedAt < 0) return;
      const k = (t - startedAt) / LIFE;
      if (k >= 1) {
        startedAt = -1;
        mesh.visible = false;
        nextAt = t + nextGap(rng, LOOK.shootingStars.minSeconds, LOOK.shootingStars.maxSeconds);
        return;
      }
      mesh.visible = true;
      head.copy(from).addScaledVector(dir, k * LENGTH * 2.2);
      tail.copy(head).addScaledVector(dir, -LENGTH * Math.min(1, k * 3));
      camera.getWorldPosition(toCam).sub(head).normalize();
      across.crossVectors(dir, toCam).normalize().multiplyScalar(1.2);
      // Corners: head ± across, tail ± a little (a tapering streak).
      const h1 = head.clone().add(across);
      const h2 = head.clone().sub(across);
      const t2 = tail.clone().sub(across.clone().multiplyScalar(0.2));
      const t1 = tail.clone().add(across.clone().multiplyScalar(0.2));
      h1.toArray(pos, 0);
      h2.toArray(pos, 3);
      t2.toArray(pos, 6);
      t1.toArray(pos, 9);
      geo.attributes.position!.needsUpdate = true;
      mat.uniforms.alpha!.value = Math.sin(Math.PI * k);
    },
    dispose() {
      parent.remove(mesh);
      geo.dispose();
      mat.dispose();
    },
  };
}
