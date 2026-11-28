// Whether two meshes pass through each other, for the growth clearance tests.
import * as THREE from "three";

export type Solid = { box: THREE.Box3; triangles: { t: THREE.Triangle; box: THREE.Box3 }[] };

export function solidOf(mesh: THREE.Mesh): Solid {
  const p = mesh.geometry.attributes.position as THREE.BufferAttribute;
  const index = mesh.geometry.index;
  const count = index ? index.count : p.count;
  const corner = (k: number) =>
    new THREE.Vector3()
      .fromBufferAttribute(p, index ? index.getX(k) : k)
      .applyMatrix4(mesh.matrixWorld);
  const box = new THREE.Box3();
  const triangles = [];
  for (let k = 0; k < count; k += 3) {
    const t = new THREE.Triangle(corner(k), corner(k + 1), corner(k + 2));
    const own = new THREE.Box3().setFromPoints([t.a, t.b, t.c]);
    box.union(own);
    triangles.push({ t, box: own });
  }
  return { box, triangles };
}

const ray = new THREE.Ray();
const hit = new THREE.Vector3();
function edgeCrosses(from: THREE.Vector3, to: THREE.Vector3, t: THREE.Triangle): boolean {
  const length = from.distanceTo(to);
  if (length < 1e-6) return false;
  ray.origin.copy(from);
  ray.direction.copy(to).sub(from).divideScalar(length);
  return !!ray.intersectTriangle(t.a, t.b, t.c, false, hit) && hit.distanceTo(from) <= length;
}

export function crosses(one: Solid, two: Solid): boolean {
  const shared = one.box.clone().intersect(two.box);
  if (shared.isEmpty()) return false;
  const near = (s: Solid) => s.triangles.filter((x) => x.box.intersectsBox(shared));
  const [ones, twos] = [near(one), near(two)];
  for (const x of ones) {
    for (const y of twos) {
      if (!x.box.intersectsBox(y.box)) continue;
      for (const [p, q] of [
        [x.t, y.t],
        [y.t, x.t],
      ] as const) {
        if (edgeCrosses(p.a, p.b, q) || edgeCrosses(p.b, p.c, q) || edgeCrosses(p.c, p.a, q)) {
          return true;
        }
      }
    }
  }
  return false;
}
