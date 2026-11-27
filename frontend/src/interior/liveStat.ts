// What a robot's monitor shows about its building's real work: a short count and a
// gauge style, never names, titles or amounts (it's visible without Touch ID). A count
// that isn't known yet (still loading, or failed) gives null: a neutral screen.
import type { BuildingId } from "../api";

export type LiveStat = { headline: string; gauge: number | null; style: "ring" | "bar" | "radar" };

export type LiveInput = {
  dueToday?: number;
  overdue?: number;
  /** The Vault's counts-only badge text; null when there's nothing to say. */
  vaultBadge?: string | null;
  /** Opportunity Office's counts-only badge text; null when nothing is due. */
  jobsBadge?: string | null;
};

export function liveStat(id: BuildingId, input: LiveInput): LiveStat | null {
  if (id === "planner") {
    if (input.dueToday === undefined || input.overdue === undefined) return null;
    const headline =
      input.overdue > 0
        ? `${input.overdue} overdue`
        : input.dueToday > 0
          ? `${input.dueToday} due today`
          : "All clear";
    return { headline, gauge: null, style: "ring" };
  }
  if (id === "finance") {
    if (input.vaultBadge === undefined) return null;
    return { headline: input.vaultBadge ?? "All in order", gauge: null, style: "bar" };
  }
  if (id === "jobs") {
    if (input.jobsBadge === undefined) return null;
    return { headline: input.jobsBadge ?? "No checks due", gauge: null, style: "radar" };
  }
  return null;
}
