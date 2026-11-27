// The level-up moment: when a waiting upgrade plays, and which phase it's in.
// Pure logic; the scene draws each phase.
import type { BuildingId, BuildingXp } from "../api";
import type { View } from "./levels.ts";
import { LOOK } from "./look.ts";

/** One upgrade to play, from the last tier celebrated to the newest reached. */
export type LevelUpPlan = { id: BuildingId; fromTier: number; toTier: number } | null;

/**
 * The upgrade to play now, or null. It plays only inside its own building (never on
 * the belt or at the screen). `ready` means no flight is running and, for the Vault,
 * it's unlocked and the door greeting is over. Several waiting tiers play as one.
 */
export function planLevelUp(b: BuildingXp, view: View, ready: boolean): LevelUpPlan {
  if (!ready || !b.earning || !b.upgrade_waiting) return null;
  if (view.level !== "building" || view.id !== b.id) return null;
  return { id: b.id, fromTier: b.celebrated_tier, toTier: b.tier };
}

export type LevelUpPhase = "dock" | "cheer" | "build" | "done";

// When the dock and cheer phases end, in seconds from the start of the moment.
const DOCK_END = 2.5;
const CHEER_END = 4;

/** The cargo shuttle docks, the robot cheers, then the new pieces build in. */
export function phaseAt(elapsedS: number): LevelUpPhase {
  if (elapsedS < DOCK_END) return "dock";
  if (elapsedS < CHEER_END) return "cheer";
  return elapsedS < CHEER_END + LOOK.growth.buildInSeconds ? "build" : "done";
}
