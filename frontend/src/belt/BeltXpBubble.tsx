// The bubble at the top right of the belt: Belt XP (level, bar, total) and the
// day / night / auto switch (SPEC section 7's manual override; Auto follows
// sunrise and sunset). If Belt XP can't be loaded, only the switch shows.
import { CHOICE_LABELS, SKY_CHOICES, type SkyChoice } from "./dayNight";
import type { DayNight } from "./useDayNight";
import { useSeenLevel, useXp } from "./useXp";
import { beltBarFraction, formatXp } from "./xp";
import { XpBar, XpLevel } from "./XpParts";

// ︎ asks for the plain text glyph, not a colour picture.
const GLYPHS: Record<SkyChoice, string> = { day: "☀︎", night: "☾", auto: "◐" };

export function BeltXpBubble({ sky }: { sky: DayNight }) {
  const data = useXp();
  const pop = useSeenLevel("belt", data, data?.belt);
  const belt = data?.belt;

  return (
    <section className="xp-bubble" aria-label={belt ? "Belt XP and sky" : "Sky"}>
      {belt && (
        <>
          <div className="xp-bubble__head">
            <span className="xp-bubble__title">Belt XP</span>
            <XpLevel level={belt.level} pop={pop === belt.level} />
          </div>
          <div className="xp-progress">
            <XpBar fraction={beltBarFraction(belt)} label="Progress to the next belt level" />
            <span className="xp-progress__text">{formatXp(belt.total_xp)} total XP</span>
          </div>
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
