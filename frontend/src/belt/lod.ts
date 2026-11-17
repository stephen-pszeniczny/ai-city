// Level of detail: robots and desks far from the camera use a lighter version
// (fewer pieces, no small parts) so nine of them stay smooth.
import { LOOK } from "./look.ts";

export type Detail = "near" | "far";

export function detailFor(distance: number): Detail {
  return distance < LOOK.farDetailDistance ? "near" : "far";
}
