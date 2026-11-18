// The notification list for the page, and the shuttle queue built from it.
//
// Asks the backend every 30 s and when the page becomes visible again. New items
// the shuttle hasn't flown for wait in a queue; each launch takes nextTrip (up to 3
// separately in a run, then everything left on one "+N more"). A shuttle launches only on the belt, never mid camera flight, and
// gapSeconds after the last one. When it lands every item it carried is marked
// seen, with the mode the list came with. A mode switch empties the queue and
// grounds a shuttle in the air without marking it seen, so nothing from one mode
// stays on screen in the other.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  dismissNotification,
  getNotifications,
  markSeen,
  type Mode,
  type NotificationItem,
} from "../api";
import { flightState } from "../belt/flightState";
import { LOOK } from "../belt/look";
import { nextTrip, queueAfterModeChange, type ShuttleTrip } from "./rules";

const POLL_MS = 30_000;
const LAUNCH_CHECK_MS = 400;

export type Notifications = {
  mode: Mode | undefined;
  items: NotificationItem[];
  /** The shuttle in the air (or showing its banner), or null. */
  trip: ShuttleTrip | null;
  /** The shuttle has landed (or its flight was cut short): mark what it carried as seen. */
  tripDone(): void;
  dismiss(id: number): void;
};

export function useNotifications(atBelt: boolean): Notifications {
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: ["notifications"],
    queryFn: getNotifications,
    retry: false,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });
  const mode = list.data?.mode;
  const items = list.data?.items ?? [];

  const [queue, setQueue] = useState<NotificationItem[]>([]);
  /** Solo flights since the queue was last empty (the parade limit counts across checks). */
  const flownInRun = useRef(0);
  const [trip, setTrip] = useState<ShuttleTrip | null>(null);
  const tripMode = useRef<Mode | undefined>(undefined);
  const lastMode = useRef<Mode | undefined>(undefined);
  const queued = useRef(new Set<number>());
  const lastLanding = useRef(0);

  // New answer: handle a mode switch, drop what's no longer active, queue what's new.
  useEffect(() => {
    if (!list.data) {
      // The list was thrown away (a mode switch resets every answer): ground everything
      // at once, unseen, so no title from the old mode stays on screen.
      setTrip(null);
      setQueue([]);
      queued.current.clear();
      return;
    }
    const { mode: now, items: active } = list.data;
    const before = lastMode.current; // read now: the update below runs after it changes
    if (before !== undefined && before !== now) {
      setQueue((q) => queueAfterModeChange(before, now, q));
      setTrip(null);
      queued.current.clear();
    }
    lastMode.current = now;
    const activeIds = new Set(active.map((n) => n.id));
    setQueue((q) => q.filter((n) => activeIds.has(n.id))); // dismissed or cleared meanwhile
    const fresh = active.filter((n) => !n.seen && !queued.current.has(n.id));
    if (fresh.length === 0) return;
    fresh.forEach((n) => queued.current.add(n.id));
    setQueue((q) => [...q, ...fresh]);
  }, [list.data]);

  // Launch the next shuttle when the belt is showing, the camera is still, and the gap has passed.
  useEffect(() => {
    if (trip || queue.length === 0 || !atBelt) return;
    const id = window.setInterval(() => {
      if (flightState.flying()) return;
      if (performance.now() - lastLanding.current < LOOK.notifications.gapSeconds * 1000) return;
      const next = nextTrip(queue, flownInRun.current, LOOK.notifications.maxSeparateShuttles);
      if (!next) return;
      flownInRun.current = next.rest.length === 0 ? 0 : flownInRun.current + 1;
      tripMode.current = lastMode.current;
      setTrip(next.trip);
      setQueue(next.rest);
    }, LAUNCH_CHECK_MS);
    return () => window.clearInterval(id);
  }, [trip, queue, atBelt]);

  const tripNow = useRef<ShuttleTrip | null>(null);
  tripNow.current = trip;
  const tripDone = useCallback(() => {
    const t = tripNow.current;
    const shownIn = tripMode.current;
    if (!t) return;
    tripNow.current = null;
    setTrip(null);
    lastLanding.current = performance.now();
    if (!shownIn) return;
    void Promise.allSettled(t.ids.map((id) => markSeen(id, shownIn))).then(() =>
      queryClient.invalidateQueries({ queryKey: ["notifications"] }),
    );
  }, [queryClient]);

  // Leaving the belt mid-flight counts as flown (it was shown).
  useEffect(() => {
    if (!atBelt) tripDone();
  }, [atBelt, tripDone]);

  const dismiss = useCallback(
    (id: number) => {
      if (!mode) return;
      void dismissNotification(id, mode)
        .catch(() => undefined) // already gone, or the mode changed: the refresh shows the truth
        .then(() => queryClient.invalidateQueries({ queryKey: ["notifications"] }));
    },
    [mode, queryClient],
  );

  return { mode, items, trip, tripDone, dismiss };
}
