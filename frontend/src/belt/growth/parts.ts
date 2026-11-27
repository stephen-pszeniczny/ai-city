// Small modelling helpers for the growth pieces: tinted materials, and a builder
// that merges a piece's still parts into one mesh per material (few draw calls).
// Everything is handed to the kit, which frees it with the rest of the scene.
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

import { LOOK } from "../look.ts";
import type { Kit } from "../materials.ts";

export type Piece = {
  group: THREE.Group;
  update(t: number): void;
  /** True while a flying copy is away, so what it copies should hide (the ship launch). */
  away?: () => boolean;
};

export type Palette = ReturnType<typeof makePalette>;

const palettes = new WeakMap<Kit, Map<string, Palette>>();

export function palette(tint: string, kit: Kit): Palette {
  let byTint = palettes.get(kit);
  if (!byTint) palettes.set(kit, (byTint = new Map()));
  let p = byTint.get(tint);
  if (!p) byTint.set(tint, (p = makePalette(tint, kit)));
  return p;
}

function makePalette(tint: string, kit: Kit) {
  const { mats, keep } = kit;
  const colour = new THREE.Color(tint);
  const std = (o: THREE.MeshStandardMaterialParameters) => keep(new THREE.MeshStandardMaterial(o));
  const light = (hex: THREE.ColorRepresentation, k: number) =>
    kit.glow(hex, k * LOOK.growth.pieceGlow);
  return {
    tint,
    hull: mats.hull,
    steel: mats.steel,
    dark: mats.darkMetal,
    solar: mats.solar,
    white: mats.radiator,
    /** Painted metal in the building's colour, a little self-lit so it reads from the belt. */
    paint: std({
      color: colour,
      roughness: 0.45,
      metalness: 0.45,
      emissive: colour,
      emissiveIntensity: 0.22,
    }),
    deep: std({ color: colour.clone().multiplyScalar(0.4), roughness: 0.55, metalness: 0.55 }),
    glass: std({
      color: colour.clone().lerp(new THREE.Color(0xffffff), 0.3),
      emissive: colour,
      emissiveIntensity: 0.4,
      roughness: 0.1,
      metalness: 0.3,
      transparent: true,
      opacity: 0.55,
    }),
    rock: std({
      color: new THREE.Color(0x6a625b).lerp(colour, 0.22),
      roughness: 0.95,
      metalness: 0.05,
      flatShading: true,
    }),
    /** Bright points: lamps and beacons. */
    lamp: light(tint, 2.8),
    /** Larger glowing areas: rims, windows, seams. */
    lit: light(tint, 1.5),
    soft: light(tint, 0.9),
    white_lamp: light(0xfff2d8, 2.6),
    /** A see-through light beam in the building's colour. */
    beam: (opacity: number) =>
      keep(
        new THREE.MeshBasicMaterial({
          color: colour.clone().multiplyScalar(2 * LOOK.growth.pieceGlow),
          transparent: true,
          opacity,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      ),
  };
}

export type At = [number, number, number];

/** A spot at `radius` from the deck's centre, toward `degrees` (0 = +x, 90 = +z). */
export function polar(degrees: number, radius: number, y = 0): THREE.Vector3 {
  const a = (degrees * Math.PI) / 180;
  return new THREE.Vector3(Math.cos(a) * radius, y, Math.sin(a) * radius);
}

const UP = new THREE.Vector3(0, 1, 0);

type AddOptions = { turn?: At | THREE.Quaternion; size?: At; near?: boolean };

export function builder(kit: Kit) {
  type List = { near: boolean; material: THREE.Material; shapes: THREE.BufferGeometry[] };
  const lists = new Map<string, List>();
  const put = (shape: THREE.BufferGeometry, material: THREE.Material, near: boolean) => {
    const flat = shape.index ? shape.toNonIndexed() : shape;
    const key = `${material.uuid}:${near}`;
    let list = lists.get(key);
    if (!list) lists.set(key, (list = { near, material, shapes: [] }));
    list.shapes.push(flat);
  };
  const matrix = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1);

  const api = {
    /**
     * Add a shape at a position, turned and stretched. `near` marks a small detail
     * that's left out when the asteroid is far from the camera.
     */
    add(
      shape: THREE.BufferGeometry,
      material: THREE.Material,
      at: At | THREE.Vector3 = [0, 0, 0],
      o: AddOptions = {},
    ) {
      const pos = Array.isArray(at) ? new THREE.Vector3(...at) : at;
      const turn = Array.isArray(o.turn)
        ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...o.turn))
        : (o.turn ?? new THREE.Quaternion());
      matrix.compose(pos, turn, o.size ? new THREE.Vector3(...o.size) : one);
      put(shape.applyMatrix4(matrix), material, o.near ?? false);
    },
    box(
      w: number,
      h: number,
      d: number,
      material: THREE.Material,
      at: At | THREE.Vector3,
      o: AddOptions = {},
    ) {
      api.add(new THREE.BoxGeometry(w, h, d), material, at, o);
    },
    cylinder(
      top: number,
      bottom: number,
      h: number,
      material: THREE.Material,
      at: At | THREE.Vector3,
      o: AddOptions & { sides?: number } = {},
    ) {
      api.add(new THREE.CylinderGeometry(top, bottom, h, o.sides ?? 16), material, at, o);
    },
    ball(
      r: number,
      material: THREE.Material,
      at: At | THREE.Vector3,
      o: { near?: boolean; size?: At } = {},
    ) {
      api.add(new THREE.SphereGeometry(r, 10, 8), material, at, o);
    },
    /** A flat ring lying on the deck (or any level). */
    hoop(
      r: number,
      tube: number,
      material: THREE.Material,
      at: At | THREE.Vector3,
      o: { near?: boolean } = {},
    ) {
      api.add(new THREE.TorusGeometry(r, tube, 6, Math.max(24, Math.round(r * 20))), material, at, {
        ...o,
        turn: [Math.PI / 2, 0, 0],
      });
    },
    /** A rod from one point to another. */
    rod(
      from: THREE.Vector3,
      to: THREE.Vector3,
      r: number,
      material: THREE.Material,
      o: { near?: boolean; sides?: number } = {},
    ) {
      const along = to.clone().sub(from);
      const length = along.length();
      if (length < 1e-4) return;
      api.cylinder(r, r, length, material, from.clone().lerp(to, 0.5), {
        turn: new THREE.Quaternion().setFromUnitVectors(UP, along.normalize()),
        sides: o.sides ?? 6,
        near: o.near,
      });
    },
    /** A smooth pipe or cable through the points. */
    pipe(points: THREE.Vector3[], r: number, material: THREE.Material, o: { near?: boolean } = {}) {
      const curve = new THREE.CatmullRomCurve3(points);
      api.add(new THREE.TubeGeometry(curve, points.length * 8, r, 6), material, [0, 0, 0], o);
    },
    /** A square lattice tower with cross bracing, from the ground up. */
    lattice(
      base: THREE.Vector3,
      height: number,
      wide: number,
      narrow: number,
      material: THREE.Material,
      levels = 4,
    ) {
      const corner = (level: number, i: number) => {
        const k = level / levels;
        const half = (wide + (narrow - wide) * k) / 2;
        const [sx, sz] = [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ][i % 4] as [number, number];
        return base.clone().add(new THREE.Vector3(sx * half, height * k, sz * half));
      };
      for (let level = 0; level < levels; level++) {
        for (let i = 0; i < 4; i++) {
          api.rod(corner(level, i), corner(level + 1, i), 0.045, material);
          api.rod(corner(level + 1, i), corner(level + 1, i + 1), 0.025, material);
          api.rod(corner(level, i), corner(level + 1, i + 1), 0.018, material, { near: true });
        }
      }
    },
    /** Make the meshes and add them to `parent`. */
    into(parent: THREE.Object3D) {
      for (const { material, shapes, near } of lists.values()) {
        const merged = mergeGeometries(shapes);
        if (!merged) throw new Error("A growth piece's shapes couldn't be merged.");
        const mesh = new THREE.Mesh(kit.keep(merged), material);
        mesh.userData.nearOnly = near;
        parent.add(mesh);
      }
      lists.clear();
    },
  };
  return api;
}

export type Builder = ReturnType<typeof builder>;

/** A still piece: builds with `make` and merges the result. */
export function still(kit: Kit, make: (b: Builder, group: THREE.Group) => void): Piece {
  const group = new THREE.Group();
  const b = builder(kit);
  make(b, group);
  b.into(group);
  return { group, update() {} };
}

/**
 * Lamps that chase each other: `spots` are lit in turn in `phases` sets. Every set
 * stays on the whole time and the lit one swells, so they never blink out.
 */
export function chaseLamps(
  kit: Kit,
  parent: THREE.Object3D,
  spots: THREE.Vector3[],
  size: number,
  material: THREE.Material,
  phases = 3,
): (t: number) => void {
  const geo = kit.keep(new THREE.SphereGeometry(size, 8, 6));
  const lamps = spots.map((at) => {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.copy(at);
    parent.add(mesh);
    return mesh;
  });
  return (t) => {
    const on = Math.floor(t * 3) % phases;
    lamps.forEach((lamp, i) => lamp.scale.setScalar(i % phases === on ? 1.5 : 0.85));
  };
}
