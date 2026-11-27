// Each desk computer's tint and desktop background: an original abstract gradient
// (never a real product's wallpaper) over near-black, coloured by the building.
import type { BuildingId } from "../api";
import { tintOf } from "../belt/tints.ts";

// Mission Control's station tint is almost white, which washes out on a screen.
const OVERRIDES: Partial<Record<BuildingId, string>> = { planner: "#9db8ff" };

export type DeskTheme = { accent: string; wallpaper: string };

export function deskTheme(id: BuildingId): DeskTheme {
  const accent = OVERRIDES[id] ?? tintOf(id);
  const wallpaper = [
    `radial-gradient(ellipse 80% 60% at 18% 12%, ${accent}55 0%, transparent 60%)`,
    `radial-gradient(ellipse 70% 70% at 85% 95%, ${accent}33 0%, transparent 65%)`,
    `radial-gradient(ellipse 60% 45% at 60% 40%, #1d2b55aa 0%, transparent 70%)`,
    "linear-gradient(160deg, #0d1528 0%, #05070c 70%)",
  ].join(", ");
  return { accent, wallpaper };
}
