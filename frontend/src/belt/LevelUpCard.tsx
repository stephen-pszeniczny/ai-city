// The card that names a level-up in the building view (bottom left): which level, and
// what's new.
// A new thing the building view can't show says where to look. It stays for a few
// seconds after the moment. Counts and names of decorations only, so the Vault's
// needs no Touch ID. Nothing in it is clickable. Render with key={id}.
import { useEffect, useSyncExternalStore } from "react";

import type { BuildingId } from "../api";
import { levelUp, newThings } from "./levelUpRun";
import { LOOK } from "./look";

/** Chips before the rest become "+N more". */
const MOST_CHIPS = 5;

export function LevelUpCard({ id }: { id: BuildingId }) {
  const { running, last, offView } = useSyncExternalStore(levelUp.subscribe, levelUp.snapshot);
  useEffect(() => {
    if (!last) return;
    const t = window.setTimeout(() => levelUp.clearLast(), LOOK.growth.moment.bannerSeconds * 1000);
    return () => window.clearTimeout(t);
  }, [last]);

  const moment = running ?? last;
  if (moment?.id !== id) return null;
  const things = newThings(id, moment.fromTier, moment.toTier);
  // The ones to look for elsewhere come first, so "+N more" never hides that hint.
  const ordered = [...things].sort(
    (a, b) => Number(offView.includes(b.key)) - Number(offView.includes(a.key)),
  );
  const elsewhere = things.some((t) => offView.includes(t.key));
  return (
    <section className="levelup-card" role="status" aria-label="Level-up">
      <span className="levelup-card__title">
        <span aria-hidden="true">▲</span> Level {moment.toTier * 10} upgrade
      </span>
      <ul className="levelup-card__chips">
        {ordered.slice(0, MOST_CHIPS).map((t) => (
          <li
            key={t.key}
            className={offView.includes(t.key) ? "levelup-chip levelup-chip--away" : "levelup-chip"}
          >
            {t.label}
            {offView.includes(t.key) && <span aria-label=", not in this view"> ↗</span>}
          </li>
        ))}
        {ordered.length > MOST_CHIPS && (
          <li className="levelup-chip">+{ordered.length - MOST_CHIPS} more</li>
        )}
      </ul>
      {elsewhere && <span className="levelup-card__where">↗ Look from the belt</span>}
    </section>
  );
}
