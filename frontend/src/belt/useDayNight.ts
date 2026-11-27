// Day or night for the belt right now: the backend's answer (worked out from the
// settings' location) combined with the sky switch's override.
//
// The backend is asked again at its next_change (sunrise or sunset), when the page
// becomes visible again, and at least every six hours. Timers can stall while the
// Mac sleeps, so a once-a-minute check of the real clock also asks again as soon as
// next_change has passed.
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { getDaylight } from "../api";
import {
  isNight,
  isPastChange,
  loadChoice,
  msUntilRefresh,
  saveChoice,
  type SkyChoice,
} from "./dayNight";

const CLOCK_CHECK_MS = 60_000;

function browserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export type DayNight = {
  night: boolean;
  moonPhase: number;
  choice: SkyChoice;
  /** False until there's something real to show (backend answered, or failed, or an override is set). */
  ready: boolean;
  choose(c: SkyChoice): void;
};

export function useDayNight(): DayNight {
  const [choice, setChoice] = useState<SkyChoice>(() => loadChoice(browserStorage()));
  const daylight = useQuery({
    queryKey: ["daylight"],
    queryFn: getDaylight,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: (q) =>
      q.state.data ? msUntilRefresh(q.state.data.next_change, Date.now()) : 60_000,
  });

  const nextChange = daylight.data?.next_change;
  const { refetch } = daylight;
  useEffect(() => {
    if (!nextChange) return;
    const id = window.setInterval(() => {
      if (isPastChange(nextChange, Date.now())) void refetch();
    }, CLOCK_CHECK_MS);
    return () => window.clearInterval(id);
  }, [nextChange, refetch]);

  const choose = useCallback((c: SkyChoice) => {
    saveChoice(browserStorage(), c);
    setChoice(c);
  }, []);

  return {
    night: isNight(choice, daylight.data),
    moonPhase: daylight.data?.moon_phase ?? 0.5,
    choice,
    ready: choice !== "auto" || daylight.status !== "pending",
    choose,
  };
}
