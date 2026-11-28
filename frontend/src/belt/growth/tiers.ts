// Which upgrade tier the scene shows for each building: the last one celebrated,
// so a waiting upgrade only appears when its level-up moment plays it. With no XP
// (still loading, or it couldn't be loaded) everything is at tier 0.
import type { BuildingId, XpView } from "../../api";

export function sceneTier(
  xp: XpView | undefined,
  /** The development preview's tier, which overrides everything, or null. */
  preview: number | null,
  id: BuildingId,
): number {
  if (preview !== null) return preview;
  const building = xp?.buildings.find((b) => b.id === id);
  return building?.earning ? building.celebrated_tier : 0;
}
