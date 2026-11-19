// Helpers for routine cards: how far along a routine is, and whether its time has come.
import type { RoutineDay } from "../api";

export function progress(r: RoutineDay): { done: number; total: number; percent: number } {
  return {
    done: r.done,
    total: r.total,
    percent: r.total === 0 ? 0 : Math.round((r.done / r.total) * 100),
  };
}

/** "HH:MM" strings compare like the times they name. */
export const isShowing = (r: RoutineDay, nowHHMM: string): boolean => nowHHMM >= r.shows_from;

/** The local time as "HH:MM". */
export function localHHMM(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
