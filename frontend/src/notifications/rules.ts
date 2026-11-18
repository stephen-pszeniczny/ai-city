// Rules for the notification shuttle and ticker (SPEC section 7, "Notifications").
// No 3D and no React in here, so all of it is tested directly.
import type { Mode, NotificationItem } from "../api";

/** One shuttle flight: the notifications it carries and the words on its banner. */
export type ShuttleTrip = { ids: number[]; text: string };

/**
 * Oldest first, one shuttle each, up to `maxSeparate`. If more are waiting (say the
 * Mac was asleep), one last shuttle carries all the rest as "+N more reminders",
 * so there's never a parade.
 */
export function planShuttles(unseen: NotificationItem[], maxSeparate: number): ShuttleTrip[] {
  const solo = unseen.slice(0, maxSeparate).map((n) => ({ ids: [n.id], text: n.title }));
  const rest = unseen.slice(maxSeparate);
  if (rest.length === 0) return solo;
  const more = `+${rest.length} more ${rest.length === 1 ? "reminder" : "reminders"}`;
  return [...solo, { ids: rest.map((n) => n.id), text: more }];
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
export function queueAfterModeChange(
  prevMode: Mode | undefined,
  nextMode: Mode,
  queue: ShuttleTrip[],
): ShuttleTrip[] {
  return prevMode !== undefined && prevMode !== nextMode ? [] : queue;
}
