// The asteroid desks' close-up lights (work light, screen glow, desk lamp), as
// ONE shared set that moves to whichever desk the camera is closest to.
//
// Why: three.js rebuilds every material in the scene whenever the number of
// lights changes. When each desk switched its own lights on as the camera came
// close, every new light count froze the first flight for a moment (the first
// flight to the Vault passes an asteroid on the way). With one fixed set, the
// count never changes, and only one desk is ever close up at a time anyway.
import * as THREE from "three";

export const DESK_LIGHT_COUNT = 3;

/** Empty markers inside a desk where its lights sit (they never hold lights themselves). */
export type DeskLightMarks = { work: THREE.Object3D; glow: THREE.Object3D; lamp: THREE.Object3D };

export class DeskLightRegistry {
  private desks = new Map<string, { marks: DeskLightMarks; near: boolean }>();
  private at = new THREE.Vector3();

  register(id: string, marks: DeskLightMarks): void {
    this.desks.set(id, { marks, near: false });
  }

  unregister(id: string): void {
    this.desks.delete(id);
  }

  setNear(id: string, near: boolean): void {
    const desk = this.desks.get(id);
    if (desk) desk.near = near;
  }

  /** The close-up desk nearest the camera, or null when no desk is close up. */
  closestNear(camera: THREE.Vector3): DeskLightMarks | null {
    let best: DeskLightMarks | null = null;
    let bestDistance = Infinity;
    for (const { marks, near } of this.desks.values()) {
      if (!near) continue;
      const d = marks.work.getWorldPosition(this.at).distanceToSquared(camera);
      if (d < bestDistance) {
        bestDistance = d;
        best = marks;
      }
    }
    return best;
  }
}

/** The one registry the belt scene and its desks share. */
export const deskLights = new DeskLightRegistry();
