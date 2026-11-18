// Rules for the notification shuttle and ticker (SPEC section 7, "Notifications").
// No 3D and no React in here, so all of it is tested directly.
import type { Mode, NotificationItem } from "../api";

/** One shuttle flight: the notifications it carries and the words on its banner. */
export type ShuttleTrip = { ids: number[]; text: string };

/**
 * The next shuttle to fly from everything waiting (oldest first). The first
 * `maxSeparate` of a run fly one by one; after that, everything still waiting goes
 * on one "+N more" shuttle. `flownInRun` counts solo flights since the queue was
 * last empty, so reminders that arrived in different checks still can't make a parade.
 */
export function nextTrip(
  pending: NotificationItem[],
  flownInRun: number,
  maxSeparate: number,
): { trip: ShuttleTrip; rest: NotificationItem[] } | null {
  const [first, ...others] = pending;
  if (!first) return null;
  if (flownInRun < maxSeparate || pending.length === 1) {
    return { trip: { ids: [first.id], text: first.title }, rest: others };
  }
  const n = pending.length;
  return {
    trip: {
      ids: pending.map((p) => p.id),
      text: `+${n} more ${n === 1 ? "reminder" : "reminders"}`,
    },
    rest: [],
  };
}

/** The ticker moves on by itself only with several items, motion allowed, and nothing hovered or focused. */
export function tickerShouldRotate(s: {
  count: number;
  reducedMotion: boolean;
  paused: boolean;
}): boolean {
  return s.count > 1 && !s.reducedMotion && !s.paused;
}

/** One readable line: trimmed, cut at a word where possible, with "…". */
export function shortTitle(title: string, maxChars: number): string {
  const t = title.trim();
  if (t.length <= maxChars) return t;
  const room = t.slice(0, maxChars - 1);
  const lastSpace = room.lastIndexOf(" ");
  const cut = lastSpace > maxChars / 2 ? room.slice(0, lastSpace) : room;
  return `${cut.trimEnd()}…`;
}

export function bannerText(trip: ShuttleTrip): string {
  return trip.ids.length > 1 ? trip.text : `REMINDER · ${trip.text}`;
}

/** "1 of 3"; nothing when there's only one. */
export function tickerPosition(index: number, count: number): string {
  return count > 1 ? `${index + 1} of ${count}` : "";
}

export function nextTickerIndex(index: number, count: number): number {
  return count > 0 ? (index + 1) % count : 0;
}

/** After a mode switch nothing from the other mode may stay queued for the screen. */
export function queueAfterModeChange<T>(
  prevMode: Mode | undefined,
  nextMode: Mode,
  queue: T[],
): T[] {
  return prevMode !== undefined && prevMode !== nextMode ? [] : queue;
}
