// What each building gains at every upgrade (every 10 levels): tier 1 is level 10,
// tier 10 is level 100. The table is "Upgrade ladders" in the Belt XP design
// (docs/superpowers/specs/2026-11-27-belt-xp-design.md). Data only, nothing is drawn here.
import type { BuildingId } from "../../api";
import { LOOK } from "../look.ts";

/** The buildings with a ladder. A later building adds its own when it's built. */
export type GrowthId = Extract<BuildingId, "planner" | "finance" | "jobs" | "career">;

/** Every add-on piece. One used by two buildings is listed once and tinted for each. */
export const PIECE_IDS = [
  // Mission Control, outside
  "hullLights",
  "extraAntenna",
  "roofDish",
  "solarWings", // also the Vault
  "windowRing",
  "dockingPort",
  "parkedShuttle", // also Opportunity Office
  "satellite",
  "beaconTower", // lights up the station hub
  // Mission Control, inside
  "wallScreens",
  "mapTable", // hologram belt map
  // The Vault, outside
  "goldTrimLights",
  "armourPlates",
  "goldDome",
  "secureDock",
  "armouredShuttle",
  "securityDrones",
  "goldBeaconRing",
  // The Vault, inside
  "depositBoxes",
  "goldShelf",
  "goldVaultDoor",
  // Opportunity Office
  "deckEdgeLights",
  "litCrater",
  "deckRing2",
  "signalRings",
  "habitatDome", // built into a crater
  "miningRig",
  "minedSeams",
  "outrigger", // the arm with its landing pad
  "twoLevelDeck", // also Flight School
  "walkwayBridges",
  "moonlet", // also Flight School
  "moonletRelay",
  "deepSpaceArray", // beams to the station
  // Flight School
  "runwayLights",
  "runwayStrip",
  "hangarDome",
  "launchTower",
  "deskRocket", // the second toy rocket
  "fuelFarm",
  "gantryArm",
  "controlTower",
  "trainingDrones",
  "shipLaunch", // the ship now and then loops the belt
] as const;

export type PieceId = (typeof PIECE_IDS)[number];

/** The landmark's look. Stage 1 is the one it starts with. */
export type LandmarkStage = 1 | 2 | 3 | 4;

export type Step = {
  tier: number;
  /** Added at this tier. Empty when the landmark's growth is the whole upgrade. */
  pieces: PieceId[];
  /** Asteroids only: the landmark grows to this stage. */
  landmarkStage?: 2 | 3 | 4;
  /** The pieces go inside a station control room, not outside. */
  interior?: boolean;
};

export const LADDERS: Record<GrowthId, Step[]> = {
  // Mission Control
  planner: [
    { tier: 1, pieces: ["hullLights"] },
    { tier: 2, pieces: ["extraAntenna"] },
    { tier: 3, pieces: ["roofDish"] },
    { tier: 4, pieces: ["solarWings"] },
    { tier: 5, pieces: ["wallScreens"], interior: true },
    { tier: 6, pieces: ["windowRing"] },
    { tier: 7, pieces: ["dockingPort", "parkedShuttle"] },
    { tier: 8, pieces: ["satellite"] },
    { tier: 9, pieces: ["mapTable"], interior: true },
    { tier: 10, pieces: ["beaconTower"] },
  ],
  // The Vault
  finance: [
    { tier: 1, pieces: ["goldTrimLights"] },
    { tier: 2, pieces: ["armourPlates"] },
    { tier: 3, pieces: ["goldDome"] },
    { tier: 4, pieces: ["solarWings"] },
    { tier: 5, pieces: ["depositBoxes"], interior: true },
    { tier: 6, pieces: ["secureDock", "armouredShuttle"] },
    { tier: 7, pieces: ["goldShelf"], interior: true },
    { tier: 8, pieces: ["securityDrones"] },
    { tier: 9, pieces: ["goldVaultDoor"], interior: true },
    { tier: 10, pieces: ["goldBeaconRing"] },
  ],
  // Opportunity Office: the radar dish
  jobs: [
    { tier: 1, pieces: ["deckEdgeLights", "litCrater"] },
    { tier: 2, pieces: ["deckRing2"] },
    { tier: 3, pieces: ["signalRings"], landmarkStage: 2 }, // the dish grows
    { tier: 4, pieces: ["habitatDome"] },
    { tier: 5, pieces: ["miningRig", "minedSeams"] },
    { tier: 6, pieces: [], landmarkStage: 3 }, // three linked dishes on raised towers
    { tier: 7, pieces: ["outrigger", "parkedShuttle"] },
    { tier: 8, pieces: ["twoLevelDeck", "walkwayBridges"] },
    { tier: 9, pieces: ["moonlet", "moonletRelay"] },
    { tier: 10, pieces: ["deepSpaceArray"], landmarkStage: 4 },
  ],
  // Flight School: the hologram ship
  career: [
    { tier: 1, pieces: ["runwayLights"] },
    { tier: 2, pieces: ["runwayStrip"] },
    { tier: 3, pieces: [], landmarkStage: 2 }, // the hologram turns into a solid small ship
    { tier: 4, pieces: ["hangarDome"] },
    { tier: 5, pieces: ["launchTower", "deskRocket"] },
    { tier: 6, pieces: [], landmarkStage: 3 }, // a bigger ship, engines glowing
    { tier: 7, pieces: ["fuelFarm", "gantryArm"] },
    { tier: 8, pieces: ["twoLevelDeck", "controlTower"] },
    { tier: 9, pieces: ["moonlet", "trainingDrones"] },
    { tier: 10, pieces: ["shipLaunch"], landmarkStage: 4 },
  ],
};

const MAX_TIER = 10;

const stepsUpTo = (id: GrowthId, tier: number): Step[] =>
  LADDERS[id].filter((step) => step.tier <= tier);

/** Every piece a building has at this tier, oldest first. Tier 0 has none. */
export const piecesUpTo = (id: GrowthId, tier: number): PieceId[] =>
  stepsUpTo(id, tier).flatMap((step) => step.pieces);

/** The landmark's stage at this tier. Station modules have no landmark and stay at 1. */
export const landmarkStageAt = (id: GrowthId, tier: number): LandmarkStage =>
  stepsUpTo(id, tier).reduce<LandmarkStage>((stage, step) => step.landmarkStage ?? stage, 1);

/**
 * How much bigger an asteroid is at this tier: 1 at tier 0, growing evenly to its
 * limit at tier 10. Pass the building to use its own lower limit, if it has one.
 */
export function asteroidScaleAt(
  tier: number,
  id?: GrowthId,
  scaleByBuilding: Partial<Record<GrowthId, number>> = LOOK.growth.scaleByBuilding,
): number {
  const max = LOOK.growth.maxAsteroidScale;
  const own = (id && scaleByBuilding[id]) ?? max;
  const limit = Math.min(max, Math.max(1, own));
  const share = Math.min(MAX_TIER, Math.max(0, tier)) / MAX_TIER;
  return 1 + (limit - 1) * share;
}
