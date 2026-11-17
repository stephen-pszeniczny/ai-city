// What an unbuilt asteroid shows: a mining rig, scaffolding around a
// half-built frame, and an "under construction" sign (spec section 7).
import * as THREE from "three";

import type { Kit } from "./materials";
import { context2d, makeCanvas } from "./space/noise";

let signTexture: THREE.CanvasTexture | null = null;

/** Amber and black hazard stripes around "UNDER CONSTRUCTION". Made once. */
function constructionSignTexture(): THREE.CanvasTexture {
  if (signTexture) return signTexture;
  const w = 512;
  const h = 256;
  const c = makeCanvas(w, h);
  const g = context2d(c);
  // Striped border.
  g.fillStyle = "#111";
  g.fillRect(0, 0, w, h);
  g.save();
  g.beginPath();
  g.rect(0, 0, w, h);
  g.clip();
  g.fillStyle = "#ffb340";
  for (let x = -h; x < w + h; x += 44) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + 22, 0);
    g.lineTo(x + 22 - h, h);
    g.lineTo(x - h, h);
    g.closePath();
    g.fill();
  }
  g.restore();
  // Panel.
  g.fillStyle = "#ffb340";
  g.fillRect(26, 26, w - 52, h - 52);
  g.strokeStyle = "#111";
  g.lineWidth = 6;
  g.strokeRect(26, 26, w - 52, h - 52);
  g.fillStyle = "#111";
  g.textAlign = "center";
  g.textBaseline = "middle";
  // Shrink the font until the longer word fits inside the panel.
  let size = 58;
  do {
    g.font = `800 ${size}px -apple-system, 'Helvetica Neue', Arial, sans-serif`;
    size -= 2;
  } while (g.measureText("CONSTRUCTION").width > w - 90 && size > 20);
  g.fillText("UNDER", w / 2, h / 2 - 34);
  g.fillText("CONSTRUCTION", w / 2, h / 2 + 34);
  signTexture = new THREE.CanvasTexture(c);
  signTexture.colorSpace = THREE.SRGBColorSpace;
  signTexture.anisotropy = 8;
  return signTexture;
}

/**
 * The sign on two posts. `face` is a group that the scene turns toward the
 * camera each frame (on its vertical axis only), so it can always be read.
 */
export function createConstructionSign(
  kit: Kit,
  scale = 1,
): { group: THREE.Group; face: THREE.Group } {
  const group = new THREE.Group();
  const face = new THREE.Group();
  group.add(face);
  const board = new THREE.Mesh(
    kit.keep(new THREE.PlaneGeometry(2.6, 1.3)),
    kit.keep(
      new THREE.MeshStandardMaterial({
        map: constructionSignTexture(),
        emissive: 0xffffff,
        emissiveMap: constructionSignTexture(),
        emissiveIntensity: 0.55, // readable on the night side too
        roughness: 0.6,
        side: THREE.DoubleSide,
      }),
    ),
  );
  board.position.y = 1.85;
  face.add(board);
  for (const x of [-1.05, 1.05]) {
    const post = new THREE.Mesh(
      kit.keep(new THREE.CylinderGeometry(0.05, 0.05, 1.9, 6)),
      kit.mats.steel,
    );
    post.position.set(x, 0.95, -0.08); // fully behind the board
    face.add(post);
  }
  group.scale.setScalar(scale);
  return { group, face };
}

/** Mining rig (spinning drill head) plus scaffolding around a half-built frame. */
export function createWorksite(
  kit: Kit,
  tint: string,
): { group: THREE.Group; update(t: number): void } {
  const { mats, glow, addBlinker } = kit;
  const group = new THREE.Group();
  const pipe = kit.keep(new THREE.CylinderGeometry(0.035, 0.035, 1, 6));

  // Mining rig: a lattice tower with a turning drill head.
  const rig = new THREE.Group();
  rig.position.set(-0.9, 0, 0.4);
  const legs: [number, number][] = [
    [-0.32, -0.32],
    [0.32, -0.32],
    [0.32, 0.32],
    [-0.32, 0.32],
  ];
  for (const [x, z] of legs) {
    const leg = new THREE.Mesh(pipe, mats.steel);
    leg.scale.y = 2.6;
    leg.position.set(x * 0.6, 1.3, z * 0.6);
    leg.rotation.set(z * 0.2, 0, -x * 0.2);
    rig.add(leg);
  }
  for (const y of [0.6, 1.3, 2.0]) {
    const ring = new THREE.Mesh(
      kit.keep(new THREE.TorusGeometry(0.28 - y * 0.05, 0.025, 4, 4)),
      mats.steel,
    );
    ring.rotation.x = Math.PI / 2;
    ring.rotation.z = Math.PI / 4;
    ring.position.y = y;
    rig.add(ring);
  }
  const head = new THREE.Group();
  head.position.y = 2.75;
  const housing = new THREE.Mesh(
    kit.keep(new THREE.BoxGeometry(0.42, 0.3, 0.42)),
    new THREE.MeshStandardMaterial({ color: 0xffb340, roughness: 0.5, metalness: 0.4 }),
  );
  kit.keep(housing.material as THREE.Material);
  head.add(housing);
  const drill = new THREE.Mesh(kit.keep(new THREE.ConeGeometry(0.12, 0.9, 10)), mats.darkMetal);
  drill.rotation.x = Math.PI;
  rig.add(head);
  rig.add(drill);
  drill.position.y = 0.45;
  addBlinker(head, new THREE.Vector3(0, 0.25, 0), tint, 1.4, 0.2, { size: 0.08 });
  group.add(rig);

  // Scaffolding around a half-built frame.
  const scaffold = new THREE.Group();
  scaffold.position.set(0.8, 0, -0.3);
  const frame = new THREE.Mesh(
    kit.keep(new THREE.BoxGeometry(1.2, 1.0, 1.0)),
    kit.keep(
      new THREE.MeshStandardMaterial({
        color: tint,
        roughness: 0.6,
        metalness: 0.3,
        transparent: true,
        opacity: 0.55,
      }),
    ),
  );
  frame.position.y = 0.5;
  scaffold.add(frame);
  const W = 1.5;
  const D = 1.3;
  const H = 1.6;
  for (const x of [-W / 2, W / 2]) {
    for (const z of [-D / 2, D / 2]) {
      const p = new THREE.Mesh(pipe, mats.steel);
      p.scale.y = H;
      p.position.set(x, H / 2, z);
      scaffold.add(p);
    }
  }
  for (const y of [0.55, 1.1, 1.6]) {
    for (const z of [-D / 2, D / 2]) {
      const p = new THREE.Mesh(pipe, mats.steel);
      p.scale.y = W;
      p.rotation.z = Math.PI / 2;
      p.position.set(0, y, z);
      scaffold.add(p);
    }
    for (const x of [-W / 2, W / 2]) {
      const p = new THREE.Mesh(pipe, mats.steel);
      p.scale.y = D;
      p.rotation.x = Math.PI / 2;
      p.position.set(x, y, 0);
      scaffold.add(p);
    }
  }
  const lamp = new THREE.Mesh(kit.keep(new THREE.SphereGeometry(0.06, 8, 6)), glow(0xffd27a, 5));
  lamp.position.set(W / 2, H + 0.05, D / 2);
  scaffold.add(lamp);
  group.add(scaffold);

  return {
    group,
    update(t) {
      head.rotation.y = t * 1.6;
      drill.rotation.y = t * 9;
    },
  };
}
