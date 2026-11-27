// Small helpers shared by the design kit's components (pure, so they're tested alone).

/** A number squeezed into 0..1; anything that isn't a number counts as 0. */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return value === Infinity ? 1 : 0;
  return Math.min(1, Math.max(0, value));
}

/** "43%": a 0..1 value as a whole percent, for widths and labels. */
export function progressPercent(value: number): string {
  return `${Math.round(clamp01(value) * 100)}%`;
}
