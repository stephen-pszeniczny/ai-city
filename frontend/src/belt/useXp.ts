// What the belt's XP bubble and a building's XP bar share: fetching Belt XP, and
// saving a newly shown level with its "+1" pop.
//
// Sample and Personal have separate XP. A mode switch resets every query, so
// ["xp"] is fetched again. Saving the seen level carries no mode, so it is sent
// only straight from the answer still held, and never while a switch is under way.
import { useIsMutating, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { getXp, markXpSeen, type BuildingId, type XpView } from "../api";
import { flightState } from "./flightState";
import { MODE_SWITCH_KEY } from "./ModeSwitch";
import { levelToMark, showsPlusOne, type ShownLevel } from "./xp";

const REFRESH_MS = 60_000;
const POP_MS = 2400; // as long as the xp-plus-pop animation in belt.css
const FLIGHT_CHECK_MS = 250;

/** Belt XP, or undefined while loading and whenever it can't be loaded. */
export function useXp(): XpView | undefined {
  const xp = useQuery({
    queryKey: ["xp"],
    queryFn: getXp,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: REFRESH_MS,
  });
  return xp.isError ? undefined : xp.data;
}

/**
 * Saves a newly shown level, and returns the level to pop "+1" on (or null).
 * `shown` is the part of `data` on screen under `key`; nothing happens until `ready`.
 * One use per key: remount (React key) to show another one.
 */
export function useSeenLevel(
  key: BuildingId | "belt",
  data: XpView | undefined,
  shown: ShownLevel | undefined,
  ready = true,
): number | null {
  const queryClient = useQueryClient();
  const switching = useIsMutating({ mutationKey: MODE_SWITCH_KEY }) > 0;
  const handled = useRef<XpView | null>(null); // each answer is acted on once
  const [pop, setPop] = useState<number | null>(null);

  useEffect(() => {
    if (!data || !shown || !ready || switching || handled.current === data) return;
    // Only the answer held right now: a mode switch may have reset it since this render.
    if (queryClient.getQueryData(["xp"]) !== data) return;
    if (queryClient.isMutating({ mutationKey: MODE_SWITCH_KEY }) > 0) return;
    const level = levelToMark(shown);
    if (level === null) return;
    handled.current = data;
    if (showsPlusOne(level, shown.seen_level)) setPop(level);
    // Sent directly, not as a mutation: React Query can hold a mutation back and send
    // it later, possibly after a switch. A refusal (409: the level changed meanwhile)
    // or any other failure is harmless; either way, ask what's true now.
    void markXpSeen(key, level)
      .catch(() => {})
      .then(() => queryClient.invalidateQueries({ queryKey: ["xp"] }));
  }, [key, data, shown, ready, switching, queryClient]);

  // Kept here, so the "+1" lasts its full time after the saved level comes back.
  useEffect(() => {
    if (pop === null) return;
    const t = window.setTimeout(() => setPop(null), POP_MS);
    return () => window.clearTimeout(t);
  }, [pop]);

  return pop;
}

/**
 * True once the camera has stopped flying, so a "+1" isn't over before you arrive.
 * Looks a moment after mounting, by when a new flight has started.
 */
export function useArrived(): boolean {
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    if (arrived) return;
    const id = window.setInterval(() => {
      if (!flightState.flying()) setArrived(true);
    }, FLIGHT_CHECK_MS);
    return () => window.clearInterval(id);
  }, [arrived]);
  return arrived;
}
