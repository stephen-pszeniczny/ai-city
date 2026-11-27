// The bubble at the top right of the belt: Belt XP (level, bar, total) and the
// day / night / auto switch (SPEC section 7's manual override; Auto follows
// sunrise and sunset). If Belt XP can't be loaded, only the switch shows.
//
// Sample and Personal have separate XP. A mode switch resets every query, so
// ["xp"] is fetched again. Saving the seen level carries no mode, so it is sent
// only straight from the answer still held, and never while a switch is under way.
import { useIsMutating, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { getXp, markXpSeen, type XpView } from "../api";
import { CHOICE_LABELS, SKY_CHOICES, type SkyChoice } from "./dayNight";
import { MODE_SWITCH_KEY } from "./ModeSwitch";
import type { DayNight } from "./useDayNight";
import { beltBarFraction, formatXp, levelToMark, showsPlusOne } from "./xp";

const REFRESH_MS = 60_000;
const POP_MS = 2400; // as long as the xp-plus-pop animation in belt.css
// ︎ asks for the plain text glyph, not a colour picture.
const GLYPHS: Record<SkyChoice, string> = { day: "☀︎", night: "☾", auto: "◐" };

export function BeltXpBubble({ sky }: { sky: DayNight }) {
  const xp = useQuery({
    queryKey: ["xp"],
    queryFn: getXp,
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: REFRESH_MS,
  });
  const data = xp.isError ? undefined : xp.data;
  const pop = useSeenLevel(data);
  const belt = data?.belt;

  return (
    <section className="xp-bubble" aria-label={belt ? "Belt XP and sky" : "Sky"}>
      {belt && (
        <>
          <div className="xp-bubble__head">
            <span className="xp-bubble__title">Belt XP</span>
            <span className="xp-bubble__level">
              {pop === belt.level && <span className="xp-bubble__plus">+1</span>}
              Lv {belt.level}
            </span>
          </div>
          <div
            className="xp-bubble__bar"
            role="progressbar"
            aria-label="Progress to the next belt level"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(beltBarFraction(belt) * 100)}
          >
            <div className="xp-bubble__fill" style={{ width: `${beltBarFraction(belt) * 100}%` }} />
          </div>
          <span className="xp-bubble__total">{formatXp(belt.total_xp)} total XP</span>
        </>
      )}
      <div className="xp-bubble__sky" role="group" aria-label="Day and night">
        {SKY_CHOICES.map((c) => (
          <button
            key={c}
            type="button"
            className="xp-bubble__option"
            aria-pressed={sky.choice === c}
            onClick={() => sky.choose(c)}
          >
            <span aria-hidden="true">{GLYPHS[c]}</span> {CHOICE_LABELS[c]}
          </button>
        ))}
      </div>
    </section>
  );
}

/** Saves a newly shown belt level, and returns the level to pop "+1" on (or null). */
function useSeenLevel(data: XpView | undefined): number | null {
  const queryClient = useQueryClient();
  const switching = useIsMutating({ mutationKey: MODE_SWITCH_KEY }) > 0;
  const handled = useRef<XpView | null>(null); // each answer is acted on once
  const [pop, setPop] = useState<number | null>(null);

  useEffect(() => {
    if (!data || switching || handled.current === data) return;
    // Only the answer held right now: a mode switch may have reset it since this render.
    if (queryClient.getQueryData(["xp"]) !== data) return;
    if (queryClient.isMutating({ mutationKey: MODE_SWITCH_KEY }) > 0) return;
    const level = levelToMark(data.belt);
    if (level === null) return;
    handled.current = data;
    if (showsPlusOne(level, data.belt.seen_level)) setPop(level);
    // Sent directly, not as a mutation: React Query can hold a mutation back and send
    // it later, possibly after a switch. A refusal (409: the level changed meanwhile)
    // or any other failure is harmless; either way, ask what's true now.
    void markXpSeen("belt", level)
      .catch(() => {})
      .then(() => queryClient.invalidateQueries({ queryKey: ["xp"] }));
  }, [data, switching, queryClient]);

  // Kept here, so the "+1" lasts its full time after the saved level comes back.
  useEffect(() => {
    if (pop === null) return;
    const t = window.setTimeout(() => setPop(null), POP_MS);
    return () => window.clearTimeout(t);
  }, [pop]);

  return pop;
}
