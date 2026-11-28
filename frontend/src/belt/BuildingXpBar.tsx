// A building's XP, shown in the building view only: name, level and the bar to
// the next level. A building that isn't earning yet says "Under construction".
// Counts only, so the Vault's needs no Touch ID. If Belt XP can't be loaded,
// nothing shows. Render with key={id}, so each building gets its own "+1".
import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { getMode, type BuildingId } from "../api";
import { levelUp } from "./levelUpRun";
import { useArrived, useSeenLevel, useXp } from "./useXp";
import { barFraction, levelProgressText } from "./xp";
import { XpBar, XpLevel } from "./XpParts";

export function BuildingXpBar({ id, name }: { id: BuildingId; name: string }) {
  const data = useXp();
  const building = data?.buildings.find((b) => b.id === id);
  const earning = building?.earning ? building : undefined;
  const mode = useQuery({ queryKey: ["mode"], queryFn: getMode, retry: false }).data;
  const playing = useSyncExternalStore(levelUp.subscribe, levelUp.snapshot).running?.id === id;
  // With an upgrade waiting, the "+1" is part of its moment: it pops when that ends.
  const waiting = !!earning?.upgrade_waiting && levelUp.playedTier(mode, id) < earning.tier;
  const pop = useSeenLevel(id, data, earning, useArrived() && !waiting);

  if (!data) return null;
  return (
    <section
      className={playing ? "xp-building xp-building--levelup" : "xp-building"}
      aria-label="Building XP"
    >
      <div className="xp-building__head">
        <span className="xp-building__name">{name}</span>
        {earning && <XpLevel level={earning.level} pop={pop === earning.level} />}
      </div>
      {earning ? (
        <div className="xp-progress">
          {/* Full while the upgrade plays; then it drops to the way to the next level. */}
          <XpBar fraction={playing ? 1 : barFraction(earning)} label="Progress to the next level" />
          <span className="xp-progress__text">
            {playing ? "Upgrade!" : levelProgressText(earning)}
          </span>
        </div>
      ) : (
        <span className="xp-building__unbuilt">Under construction</span>
      )}
    </section>
  );
}
