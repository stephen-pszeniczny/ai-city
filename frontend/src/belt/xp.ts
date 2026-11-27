// How Belt XP is shown: the level bar, the "+1" pop and the XP number.
import type { BeltXp, BuildingXp } from "../api";

const MAX_LEVEL = 100; // as in the backend (xp_rules.py)

/** How full the bar is, 0 to 1, from this level's start to the next level. */
export function barFraction(b: BuildingXp): number {
  if (b.level >= MAX_LEVEL) return 1;
  const span = b.next_level_xp - b.level_start_xp;
  if (span <= 0) return 0; // a building not earning yet is all zeros
  // Clamped: after an undo, XP can sit under the level that is still shown.
  return Math.min(1, Math.max(0, (b.xp - b.level_start_xp) / span));
}

/** How full the belt's bar is, 0 to 1. */
export const beltBarFraction = (belt: BeltXp): number =>
  belt.level >= MAX_LEVEL ? 1 : Math.min(1, Math.max(0, belt.progress));

/** A level on screen (the belt's or a building's), and the last one saved as seen. */
export type ShownLevel = { level: number; seen_level: number };

/**
 * The level to save as seen, or null when there's nothing new. The first-ever
 * look counts too: it doesn't pop, but a later level can only pop once it's saved.
 */
export const levelToMark = (shown: ShownLevel): number | null =>
  shown.level > shown.seen_level ? shown.level : null;

/** True for a level gained since the last look; never on the first-ever look. */
export const showsPlusOne = (level: number, seenLevel: number): boolean =>
  seenLevel > 0 && level > seenLevel;

/** XP into the level out of the level's size, e.g. "310 / 780 XP". */
export function levelProgressText(b: BuildingXp): string {
  if (b.level >= MAX_LEVEL) return "Max level";
  const span = b.next_level_xp - b.level_start_xp;
  const into = Math.min(span, Math.max(0, b.xp - b.level_start_xp)); // as in barFraction
  return `${formatXp(into)} / ${formatXp(span)} XP`;
}

/** 1840 as "1,840". */
export const formatXp = (n: number): string => n.toLocaleString("en-US");
