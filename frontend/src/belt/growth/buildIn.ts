// New upgrade pieces building themselves in: each grows from the foot of where it
// stands, inside a glow and rising sparks in the building's colour.
//
// The growth system's own groups and materials are only borrowed: nothing is added
// to them and no material is tinted. The glow is a separate group with its own
// materials. Some pieces move themselves each frame and some have a size of their
// own, so every frame goes: restore() before the pieces update, apply(k) after.
import * as THREE from "three";

import { LOOK } from "../look.ts";
import { softGlow } from "../space/noise.ts";

/**
 * A piece wider than this gets no halo: one big enough would white out the view and
 * be cut in a straight line by the deck. Its sparks trace its shape instead.
 */
const WIDEST_HALO = 2.2;
const SPARKS = 60;
/** The last piece to start waits this share of the build. */
const STAGGER = 0.3;
/** Never quite nothing: a size of zero can't be drawn or measured. */
const SMALLEST = 0.001;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** 0 to 1, overshooting a little near the end when `bounce` is above 0. */
function pop(k: number, bounce: number): number {
  const c = 1.7 * bounce;
  const x = k - 1;
  return 1 + (c + 1) * x * x * x + c * x * x;
}

/** Points spread over the piece's surfaces, in `root`'s coordinates. */
function surfacePoints(group: THREE.Object3D, root: THREE.Object3D): Float32Array {
  const all: THREE.BufferAttribute[] = [];
  const places: THREE.Matrix4[] = [];
  let total = 0;
  root.updateWorldMatrix(true, false);
  const toRoot = root.matrixWorld.clone().invert();
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const positions = mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
    all.push(positions);
    places.push(toRoot.clone().multiply(o.matrixWorld));
    total += positions.count;
  });
  const out = new Float32Array((total ? SPARKS : 0) * 3);
  const point = new THREE.Vector3();
  for (let n = 0; n < out.length / 3; n++) {
    // Evenly through every vertex of every mesh, so big and small parts both show.
    let at = Math.floor(((n + 0.5) / SPARKS) * total);
    let i = 0;
    while (at >= all[i]!.count) at -= all[i++]!.count;
    point.fromBufferAttribute(all[i]!, at).applyMatrix4(places[i]!);
    point.toArray(out, n * 3);
  }
  return out;
}

export function createBuildIn(
  groups: THREE.Group[],
  /** Where the glow goes: must not be a group the growth system clears. */
  root: THREE.Object3D,
  tint: string,
  o: { glow?: number; motion?: number; texture?: THREE.Texture } = {},
) {
  const glow = o.glow ?? LOOK.growth.pieceGlow;
  const motion = o.motion ?? LOOK.growth.pieceMotion;
  const texture = o.texture ?? softGlow();
  const overlay = new THREE.Group();
  overlay.name = "buildInGlow";
  root.add(overlay);
  const owned: { dispose(): void }[] = [];
  const colour = new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.25).multiplyScalar(1.8);
  const additive = {
    map: texture,
    color: colour,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  } as const;

  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  const centre = new THREE.Vector3();

  const items = groups.map((group, i) => {
    group.updateWorldMatrix(true, true);
    box.setFromObject(group);
    if (box.isEmpty()) box.set(group.position.clone(), group.position.clone());
    box.getCenter(centre);
    box.getSize(size);
    // The foot of the piece, as an offset from its position, in its parent's space.
    const foot = new THREE.Vector3(centre.x, box.min.y, centre.z);
    group.parent?.worldToLocal(foot);
    const offset = foot.sub(group.position);

    root.updateWorldMatrix(true, false);
    const at = root.worldToLocal(centre.clone());
    const wide = Math.max(size.x, size.y, size.z, 0.35);

    let halo: THREE.SpriteMaterial | null = null;
    if (wide <= WIDEST_HALO) {
      // Drawn over whatever is near, so the deck can't slice it.
      halo = new THREE.SpriteMaterial({ ...additive, depthTest: false });
      const sprite = new THREE.Sprite(halo);
      sprite.position.copy(at);
      sprite.scale.setScalar(wide * 1.5);
      sprite.raycast = () => {};
      overlay.add(sprite);
      owned.push(halo);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(surfacePoints(group, root), 3));
    const sparkMat = new THREE.PointsMaterial({
      ...additive,
      size: THREE.MathUtils.clamp(wide * 0.09, 0.1, 0.4),
    });
    const sparks = new THREE.Points(geometry, sparkMat);
    sparks.raycast = () => {};
    overlay.add(sparks);
    owned.push(geometry, sparkMat);

    return {
      group,
      offset,
      halo,
      sparks,
      sparkMat,
      rise: Math.min(wide * 0.35, 0.7),
      delay: groups.length > 1 ? (i / (groups.length - 1)) * STAGGER : 0,
      position: new THREE.Vector3(),
      scale: new THREE.Vector3(),
      applied: false,
    };
  });

  return {
    overlay,
    /** k runs 0 (nothing yet) to 1 (all built). Call after the pieces have updated. */
    apply(k: number) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        const own = clamp01((clamp01(k) - item.delay) / (1 - STAGGER));
        const s = Math.max(SMALLEST, pop(own, motion));
        item.position.copy(item.group.position);
        item.scale.copy(item.group.scale);
        item.applied = true;
        item.group.position.addScaledVector(item.offset, 1 - s);
        item.group.scale.multiplyScalar(s);
        const shine = Math.sin(Math.PI * own) * glow;
        if (item.halo) item.halo.opacity = 0.45 * shine;
        item.sparkMat.opacity = Math.min(1, shine);
        item.sparks.position.y = (own - 0.5) * item.rise * motion;
      }
    },
    /** Put back what apply() changed. Call before the pieces update. */
    restore() {
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        if (!item.applied) continue;
        item.group.position.copy(item.position);
        item.group.scale.copy(item.scale);
        item.applied = false;
      }
    },
    dispose() {
      this.restore();
      overlay.removeFromParent();
      owned.forEach((x) => x.dispose());
    },
  };
}

export type BuildIn = ReturnType<typeof createBuildIn>;
