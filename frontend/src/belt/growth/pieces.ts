// One model per upgrade piece, tinted in its building's colour. The asteroids'
// pieces are here; the station modules' (and the control rooms') join MODELS when
// they're drawn.
//
// A piece comes already placed: asteroid pieces in deck coordinates (the deck's
// centre, y = 0 on its top), except the desk rocket, which is in the desk's own
// coordinates. A building that wants a shared piece elsewhere moves its group.
import type { Kit } from "../materials.ts";
import * as career from "./careerPieces.ts";
import type { Ground } from "./ground.ts";
import * as jobs from "./jobsPieces.ts";
import type { PieceId } from "./ladders.ts";
import type { Piece } from "./parts.ts";
import * as shared from "./sharedPieces.ts";

type Model = (tint: string, kit: Kit, ground: Ground) => Piece;

const MODELS: Partial<Record<PieceId, Model>> = {
  // Shared.
  parkedShuttle: shared.parkedShuttle,
  twoLevelDeck: shared.twoLevelDeck,
  moonlet: shared.moonlet,
  moonletRelay: shared.moonletRelay,
  trainingDrones: shared.trainingDrones,
  // Opportunity Office.
  deckEdgeLights: jobs.deckEdgeLights,
  litCrater: jobs.litCrater,
  deckRing2: jobs.deckRing2,
  signalRings: jobs.signalRings,
  habitatDome: jobs.habitatDome,
  miningRig: jobs.miningRig,
  minedSeams: jobs.minedSeams,
  outrigger: jobs.outrigger,
  walkwayBridges: jobs.walkwayBridges,
  deepSpaceArray: jobs.deepSpaceArray,
  // Flight School.
  runwayLights: career.runwayLights,
  runwayStrip: career.runwayStrip,
  hangarDome: career.hangarDome,
  launchTower: career.launchTower,
  deskRocket: career.deskRocket,
  fuelFarm: career.fuelFarm,
  gantryArm: career.gantryArm,
  controlTower: career.controlTower,
  shipLaunch: career.shipLaunch,
};

/** Pieces that stand on the robot's desk rather than the asteroid. */
export const DESK_PIECES: ReadonlySet<PieceId> = new Set<PieceId>(["deskRocket"]);

/** A rock to build against when none is given (a station module has none). */
const NO_ROCK: Ground = { top: () => 0, radius: () => 6, maxRadius: () => 6 };

export const hasPiece = (id: PieceId): boolean => id in MODELS;

export function createPiece(id: PieceId, tint: string, kit: Kit, ground: Ground = NO_ROCK): Piece {
  const model = MODELS[id];
  if (!model) throw new Error(`There's no model for the piece "${id}" yet.`);
  const piece = model(tint, kit, ground);
  piece.group.name = id;
  piece.update(0); // moving parts start where their motion does
  return piece;
}
