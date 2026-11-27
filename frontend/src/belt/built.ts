// Which buildings are built. Everything else shows as under construction:
// an asteroid gets mining rigs, scaffolding and a sign instead of its landmark.
// Add a building's ID here in the phase that finishes it, and to EARNING_BUILDINGS
// in src/aicity/xp_rules.py, so it starts earning XP (a test compares the two).
// docs/RUNBOOK.md ("Belt XP: adding a building") lists everything else it needs.
import type { BuildingId } from "../api";

export const BUILT: ReadonlySet<BuildingId> = new Set<BuildingId>(["planner", "finance", "jobs"]);
