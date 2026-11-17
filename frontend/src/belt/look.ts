// Every "how much" for the 3D belt in one place.
// To tone something down, lower its number and reload the page.
export const LOOK = {
  /** Beyond this distance (scene units) desks and robots switch to their simpler version. */
  farDetailDistance: 22,

  robot: {
    /** Visor and antenna glow (0 = off, 1 = full). */
    glowStrength: 1.0,
    /** Size of the gentle idle bob. */
    bob: 1.0,
    /** How often it changes action (lower = calmer, longer actions). */
    busyness: 1.0,
    /** Share of actions that are just for fun: spinning, waving, stretching. */
    funActions: 0.15,
  },

  /** Desk gadgets: the toy rocket, mail drone, radar and so on. */
  gadgets: { enabled: true, speed: 1.0 },
  /** How high the hologram floats above the asteroid's deck. */
  hologramHeight: 3.2,

  station: {
    /** Moving bars, gauges and waveforms on the wall panels. */
    wallPanelMotion: 1.0,
    blinkingLights: 1.0,
  },

  flights: { toAsteroidSeconds: 3, toStationSeconds: 6 },

  earth: { cityLights: 1.0, cloudSpeed: 1.0 },
  /** Gap between shooting stars, in seconds. */
  shootingStars: { minSeconds: 20, maxSeconds: 60 },
} as const;

/** How fast small motions run: calmer when the person asked for reduced motion. */
export function motionScale(reduced: boolean): number {
  return reduced ? 0.3 : 1;
}
