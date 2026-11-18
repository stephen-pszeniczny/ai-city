// Day or night for the belt right now: the backend's answer (worked out from the
// settings' location) combined with the Sky button's override.
//
// The backend is asked again at its next_change (sunrise or sunset), whenever the
// window comes back into focus (the Mac may have slept through a change), and at
// least every six hours.
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { getDaylight } from "../api";
import {
  isNight,
  loadChoice,
  msUntilRefresh,
  nextChoice,
  saveChoice,
  type SkyChoice,
} from "./dayNight";

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
  /** True when the last change came from the Sky button (it fades quicker). */
  byHand: boolean;
  cycle(): void;
};

export function useDayNight(): DayNight {
  const [choice, setChoice] = useState<SkyChoice>(() => loadChoice(browserStorage()));
  const [byHand, setByHand] = useState(false);
  const daylight = useQuery({
    queryKey: ["daylight"],
    queryFn: getDaylight,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: (q) =>
      q.state.data ? msUntilRefresh(q.state.data.next_change, Date.now()) : 60_000,
  });

  // A change from the backend (sunrise or sunset) is not a button press.
  const lastAnswer = useRef<boolean | undefined>(undefined);
  const answer = daylight.data?.is_night;
  useEffect(() => {
    if (answer !== lastAnswer.current) {
      lastAnswer.current = answer;
      setByHand(false);
    }
  }, [answer]);

  const cycle = useCallback(() => {
    setChoice((c) => {
      const next = nextChoice(c);
      saveChoice(browserStorage(), next);
      return next;
    });
    setByHand(true);
  }, []);

  return {
    night: isNight(choice, daylight.data),
    moonPhase: daylight.data?.moon_phase ?? 0.5,
    choice,
    ready: choice !== "auto" || daylight.status !== "pending",
    byHand,
    cycle,
  };
}
