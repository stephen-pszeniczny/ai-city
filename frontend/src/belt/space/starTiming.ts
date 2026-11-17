// When the next shooting star crosses the sky. Pure, so it can be tested.

/** Seconds until the next shooting star, between min and max. */
export function nextGap(rng: () => number, min: number, max: number): number {
  return min + (max - min) * rng();
}

/** Shooting stars are off when the person asked for reduced motion. */
export function shootingStarsEnabled(reducedMotion: boolean): boolean {
  return !reducedMotion;
}
