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

  warmUp: {
    /** How long after the belt appears to quietly prepare the station's inside. */
    interiorAfterMs: 1500,
  },
  flights: {
    toAsteroidSeconds: 3,
    /** Belt → Mission Control or the Vault (plus the door greeting, the first time). */
    toStationSeconds: 6,
    /** Mission Control or the Vault → belt. */
    fromStationSeconds: 6,
    /** Mission Control ↔ the Vault, through the hallways and hub. */
    roomToRoomSeconds: 5,
    /** How far ahead along a station route the camera looks (station units). */
    lookAhead: 3.5,
    /** Outside the station the camera covers ground faster: time per unit of distance there. */
    outsideWeight: 0.2,
  },

  earth: { cityLights: 1.0, cloudSpeed: 1.0 },

  dayNight: {
    /** Seconds the sunset/sunrise fade takes when it switches while you watch. */
    fadeSeconds: 20,
    /** Seconds the fade takes after pressing the Sky button (quicker, so it feels responsive). */
    buttonFadeSeconds: 3,
    /** Sunlight left at night (day is 3.4). Higher = lighter nights. */
    nightSunStrength: 0.3,
    /** Soft fill light from the viewer's side at night (day is 0.55); keeps asteroid colours readable. */
    nightFillStrength: 1.5,
    /** How much brighter the stars are at night (1 = same as day). */
    nightStarBrightness: 1.6,
    /** How much brighter the station's windows glow at night (1 = same as day). */
    stationLightGlow: 1.8,
    /** Moon brightness at night (0 = hidden, 1 = full). */
    moonBrightness: 1.0,
    /** Moon size (1 = the original small moon; bigger shows its craters better). */
    moonSize: 1.4,
  },
  notifications: {
    /** Seconds the shuttle takes to cross the screen. */
    flightSeconds: 7,
    /** Seconds between one shuttle leaving and the next arriving. */
    gapSeconds: 1.5,
    /** Rocket size (1 = about a sixth of the station's length). */
    rocketSize: 1.0,
    /** Engine glow under the rocket (0 = off, 1 = full). */
    glowStrength: 1.0,
    /** Longest banner title before it's cut with "…". */
    bannerMaxChars: 48,
    /** Seconds each reminder shows in the ticker before the next. */
    tickerSecondsPerItem: 6,
    /** With reduced motion: seconds the banner shows at the top instead of a flight. */
    reducedMotionBannerSeconds: 5,
    /** Shuttles that fly one by one before the rest share one "+N more" shuttle. */
    maxSeparateShuttles: 3,
  },

  /** Gap between shooting stars, in seconds. */
  shootingStars: { minSeconds: 20, maxSeconds: 60 },
} as const;

/** How fast small motions run: calmer when the person asked for reduced motion. */
export function motionScale(reduced: boolean): number {
  return reduced ? 0.3 : 1;
}
