// The two pieces the XP bubble and a building's XP bar draw the same way.

/** "Lv 7", with "+1" popping beside it when `pop` is true. */
export function XpLevel({ level, pop }: { level: number; pop: boolean }) {
  return (
    <span className="xp-level">
      {pop && <span className="xp-level__plus">+1</span>}
      Lv {level}
    </span>
  );
}

/** The level bar, filled from 0 to 1. */
export function XpBar({ fraction, label }: { fraction: number; label: string }) {
  return (
    <div
      className="xp-bar"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(fraction * 100)}
    >
      <div className="xp-bar__fill" style={{ width: `${fraction * 100}%` }} />
    </div>
  );
}
