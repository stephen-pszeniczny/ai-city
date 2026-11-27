// A building's XP, shown in the building view only: name, level and the bar to
// the next level. A building that isn't earning yet says "Under construction".
// Counts only, so the Vault's needs no Touch ID. If Belt XP can't be loaded,
// nothing shows. Render with key={id}, so each building gets its own "+1".
import type { BuildingId } from "../api";
import { useArrived, useSeenLevel, useXp } from "./useXp";
import { barFraction, levelProgressText } from "./xp";
import { XpBar, XpLevel } from "./XpParts";

export function BuildingXpBar({ id, name }: { id: BuildingId; name: string }) {
  const data = useXp();
  const building = data?.buildings.find((b) => b.id === id);
  const earning = building?.earning ? building : undefined;
  const pop = useSeenLevel(id, data, earning, useArrived());

  if (!data) return null;
  return (
    <section className="xp-building" aria-label="Building XP">
      <div className="xp-building__head">
        <span className="xp-building__name">{name}</span>
        {earning && <XpLevel level={earning.level} pop={pop === earning.level} />}
      </div>
      {earning ? (
        <div className="xp-progress">
          <XpBar fraction={barFraction(earning)} label="Progress to the next level" />
          <span className="xp-progress__text">{levelProgressText(earning)}</span>
        </div>
      ) : (
        <span className="xp-building__unbuilt">Under construction</span>
      )}
    </section>
  );
}
