// Holograms for buildings that aren't built yet: the asteroid's future
// landmark projected as a translucent, flickering blueprint, with
// "UNDER CONSTRUCTION" floating over it in holographic lettering.
import * as THREE from "three";

import type { Kit } from "./materials";
import { context2d, makeCanvas } from "./space/noise";

const HOLO_CYAN = new THREE.Color(0x7fe8ff);

export type Hologram = { update(t: number): void };

/** Turns every mesh in `root` into a translucent, glowing wireframe projection. */
export function makeHologram(root: THREE.Object3D, kit: Kit, tint: string): Hologram {
  const colour = new THREE.Color(tint).lerp(HOLO_CYAN, 0.55);
  const fill = kit.keep(
    new THREE.MeshBasicMaterial({
      color: colour.clone().multiplyScalar(0.8),
      transparent: true,
      opacity: 0.16,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  const wire = kit.keep(
    new THREE.MeshBasicMaterial({
      color: colour.clone().multiplyScalar(1.1),
      wireframe: true,
      transparent: true,
      opacity: 0.32,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh);
    if ((o as THREE.Sprite).isSprite) o.visible = false; // glows don't project
  });
  for (const m of meshes) {
    m.material = fill;
    m.castShadow = false;
    const outline = new THREE.Mesh(m.geometry, wire);
    m.add(outline);
  }
  return {
    update(t) {
      // Mostly steady, with brief flickers like a projection.
      const flicker = Math.sin(t * 31) > 0.96 || Math.sin(t * 7.3) > 0.995 ? 0.35 : 1;
      fill.opacity = 0.16 * flicker;
      wire.opacity = 0.32 * flicker;
    },
  };
}

let textTexture: THREE.CanvasTexture | null = null;

/** "UNDER CONSTRUCTION" with scan lines and hazard ticks, on a transparent background. */
function holoTextTexture(): THREE.CanvasTexture {
  if (textTexture) return textTexture;
  const w = 1024;
  const h = 256;
  const c = makeCanvas(w, h);
  const g = context2d(c);
  g.clearRect(0, 0, w, h);
  // Thin frame with amber hazard ticks at the corners.
  g.strokeStyle = "rgba(127, 232, 255, 0.55)";
  g.lineWidth = 3;
  g.strokeRect(12, 12, w - 24, h - 24);
  g.fillStyle = "rgba(255, 179, 64, 0.85)";
  for (const [x, y] of [
    [12, 12],
    [w - 72, 12],
    [12, h - 20],
    [w - 72, h - 20],
  ] as const) {
    for (let i = 0; i < 3; i++) g.fillRect(x + i * 20, y, 12, 8);
  }
  // The words, glowing.
  g.textAlign = "center";
  g.textBaseline = "middle";
  // Shrink the font until the words fit inside the frame.
  let size = 92;
  do {
    g.font = `800 ${size}px -apple-system, 'Helvetica Neue', Arial, sans-serif`;
    size -= 2;
  } while (g.measureText("UNDER CONSTRUCTION").width > w - 140 && size > 20);
  g.shadowColor = "rgba(127, 232, 255, 0.9)";
  g.shadowBlur = 24;
  g.fillStyle = "rgba(220, 250, 255, 0.95)";
  g.fillText("UNDER CONSTRUCTION", w / 2, h / 2 + 4);
  g.shadowBlur = 0;
  // Scan lines.
  g.globalCompositeOperation = "destination-out";
  g.fillStyle = "rgba(0, 0, 0, 0.35)";
  for (let y = 0; y < h; y += 6) g.fillRect(0, y, w, 2);
  g.globalCompositeOperation = "source-over";
  textTexture = new THREE.CanvasTexture(c);
  textTexture.colorSpace = THREE.SRGBColorSpace;
  textTexture.anisotropy = 8;
  return textTexture;
}

/**
 * The floating banner. `face` is turned toward the camera each frame (on its
 * vertical axis only) so it can always be read.
 */
export function createHoloBanner(kit: Kit): {
  group: THREE.Group;
  face: THREE.Group;
  update(t: number): void;
} {
  const group = new THREE.Group();
  const face = new THREE.Group();
  group.add(face);
  const mat = kit.keep(
    new THREE.MeshBasicMaterial({
      map: holoTextTexture(),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  face.add(new THREE.Mesh(kit.keep(new THREE.PlaneGeometry(5.2, 1.3)), mat));
  return {
    group,
    face,
    update(t) {
      group.position.y = 4.6 + Math.sin(t * 1.1) * 0.08; // gentle hover
      mat.opacity = Math.sin(t * 23) > 0.97 ? 0.4 : 0.9;
    },
  };
}
