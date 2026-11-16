// Which buildings are built. Everything else shows as under construction:
// an asteroid gets mining rigs, scaffolding and a sign instead of its landmark.
// Add a building's ID here in the phase that finishes it.
import type { BuildingId } from "../api";

export const BUILT: ReadonlySet<BuildingId> = new Set<BuildingId>(["planner"]);
