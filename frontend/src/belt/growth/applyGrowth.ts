// Puts a building at an upgrade tier. An asteroid gains its pieces, swaps the
// landmark's stage and changes size; a station module gains pieces outside, and its
// control room gains them inside. Pieces are built the first time they're shown and
// kept, so going back and forth builds nothing twice; the kit frees them all.
// Unbuilt asteroids don't grow.
import * as THREE from "three";

import type { BuildingId } from "../../api";
import type { Station, StationModule } from "../station.ts";
import { WORK_AT, WORK_SCALE } from "../../interior/workspace.ts";
import { createLandmark } from "../landmarks.ts";
import { tintOf } from "../tints.ts";
import { standLandmark } from "./landmarkStages.ts";
import type { Detail } from "../lod.ts";
import { LOOK } from "../look.ts";
import type { Kit } from "../materials.ts";
import type { Ground } from "./ground.ts";
import {
  asteroidScaleAt,
  LADDERS,
  landmarkStageAt,
  modulePiecesUpTo,
  piecesUpTo,
  type LandmarkStage,
  type PieceId,
} from "./ladders.ts";
import { FLYING, MODULE_PLACE } from "./modulePieces.ts";
import type { Piece } from "./parts.ts";
import { createPiece, DESK_PIECES } from "./pieces.ts";

/** The label's height over the deck before any growth. */
const LABEL_HEIGHT = 4.6;

export type GrowthHandle = {
  /** The tier on show: 0 (nothing added) to 10. */
  tier: number;
  setTier(tier: number): void;
  /** What arrived with `tier`, if it's on show: its pieces, then a grown landmark. */
  newPiecesFor(tier: number): THREE.Group[];
  /**
   * Animate at time t. Today's landmark (stage 1) always moves, as it did before
   * upgrades. Pieces and grown landmarks hold still while `hold` (the computer
   * screen is open) and slow down by `motion` for reduced motion.
   */
  update(t: number, o?: { hold?: boolean; motion?: number }): void;
  /** Far away, small details are left out (see lod.ts). */
  setDetail(detail: Detail): void;
  /** How high over the deck the building's label needs to be. */
  labelHeight(): number;
  /** The landmark on show. A station module has none: an empty group. */
  landmark(): THREE.Group;
  /** The building's pieces on show (an asteroid's or a module's outside), in ladder order. */
  pieces: THREE.Group;
};

type Model = { group: THREE.Group; update(t: number): void };

export type PieceTiming = { hold?: boolean; motion?: number };

/**
 * A building's pieces: built the first time they're shown, kept, tagged as the
 * building, and animated together. While held they stay where they are, and anything
 * just shown starts where the others are.
 */
function createRack({
  id,
  tint,
  kit,
  ground,
  mountFor,
  place,
}: {
  id: BuildingId;
  tint: string;
  kit: Kit;
  ground?: Ground;
  /** The group each piece goes in. */
  mountFor(piece: PieceId): THREE.Group;
  /** Moves a freshly built piece this building wants somewhere else. */
  place?(piece: PieceId, group: THREE.Group): void;
}) {
  const made = new Map<PieceId, Piece>();
  const mounted = new Set<THREE.Group>();
  let shown: Piece[] = [];
  let detail: Detail = "near";
  /** The moment the pieces are at: it stops advancing while they're held. */
  let time = 0;

  const showDetail = (root: THREE.Object3D) =>
    root.traverse((o) => {
      if (o.userData.nearOnly) o.visible = detail === "near";
    });

  return {
    showDetail,
    shown: () => shown,
    time: () => time,
    detail: () => detail,
    /** The piece's group, if it's on show. */
    groupOf: (piece: PieceId) => made.get(piece)!.group,
    show(ids: readonly PieceId[]) {
      for (const group of mounted) group.clear();
      shown = ids.map((pieceId) => {
        let piece = made.get(pieceId);
        if (!piece) {
          piece = createPiece(pieceId, tint, kit, ground);
          place?.(pieceId, piece.group);
          tag(piece.group, id);
          made.set(pieceId, piece);
        }
        const mount = mountFor(pieceId);
        mounted.add(mount);
        mount.add(piece.group);
        showDetail(piece.group);
        return piece;
      });
    },
    /** Bring what's on show to the current moment, even during a hold. */
    settle() {
      for (const piece of shown) {
        piece.update(time);
        piece.aim?.();
      }
    },
    update(t: number, { hold = false, motion = 1 }: PieceTiming = {}) {
      if (hold) return;
      time = t * motion * LOOK.growth.pieceMotion;
      for (const piece of shown) piece.update(time);
    },
    aim() {
      for (const piece of shown) piece.aim?.();
    },
    /** True when it changed, so the caller can pass it on to anything else it shows. */
    setDetail(next: Detail): boolean {
      if (next === detail) return false;
      detail = next;
      for (const piece of shown) showDetail(piece.group);
      return true;
    },
  };
}

const clampTier = (tier: number) => Math.min(10, Math.max(0, Math.round(tier)));

export function createGrowth({
  id,
  tint,
  kit,
  built,
  holder,
  desk,
  landmark: first,
  ground,
  onScale,
}: {
  id: BuildingId;
  tint: string;
  kit: Kit;
  built: boolean;
  /** Stands on the deck and grows with the asteroid. */
  holder: THREE.Group;
  /** At the deck's centre but outside what grows, so the desk keeps its size. */
  desk: THREE.Group;
  /** The stage-1 landmark, already in `holder`. */
  landmark: Model;
  ground: Ground;
  onScale(scale: number): void;
}): GrowthHandle {
  const ladder = built && (id === "jobs" || id === "career") ? id : null;
  const pieces = new THREE.Group();
  pieces.name = "pieces";
  const onDesk = new THREE.Group();
  onDesk.position.copy(WORK_AT);
  onDesk.scale.setScalar(WORK_SCALE);
  tag(pieces, id);
  tag(onDesk, id);
  holder.add(pieces);
  desk.add(onDesk);

  // A built asteroid's landmark stands off-centre, clear of the desk, from the start.
  // (An unbuilt one stays in the middle, where its hologram is projected from.)
  if (ladder) standLandmark(first.group, ladder, tint, kit);
  const stages = new Map<LandmarkStage, Model>([[1, first]]);
  first.group.name = "landmark";
  first.group.userData.stage = 1;
  tag(first.group, id);
  // Once a grown stage replaces it, nothing in the scene frees the first one, so the kit does.
  if (ladder) {
    first.group.traverse((o) => {
      const geometry = (o as THREE.Mesh).geometry;
      if (geometry) kit.keep(geometry);
    });
  }
  const rack = createRack({
    id,
    tint,
    kit,
    ground,
    mountFor: (pieceId) => (DESK_PIECES.has(pieceId) ? onDesk : pieces),
  });
  let landmark = first;
  let labelHeight = LABEL_HEIGHT;
  /** The grown ship on the landmark on show, if it has one. */
  let ship: THREE.Object3D | undefined;

  /** The ship on its pad hides while its flying copy is away. */
  const showShip = () => {
    if (ship) ship.visible = !rack.shown().some((p) => p.away?.());
  };

  const stageModel = (stage: LandmarkStage, as: "jobs" | "career"): Model => {
    let model = stages.get(stage);
    if (!model) {
      model = createLandmark(as, tint, kit, stage);
      model.group.name = "landmark";
      tag(model.group, id);
      stages.set(stage, model);
    }
    return model;
  };

  const handle: GrowthHandle = {
    tier: 0,
    pieces,
    landmark: () => landmark.group,
    labelHeight: () => labelHeight,
    setTier(wanted) {
      if (!ladder) return;
      const tier = clampTier(wanted);
      rack.show(piecesUpTo(ladder, tier));

      const next = stageModel(landmarkStageAt(ladder, tier), ladder);
      if (next !== landmark) {
        holder.remove(landmark.group);
        holder.add(next.group);
        landmark = next;
        ship = landmark.group.getObjectByName("ship");
        rack.showDetail(landmark.group);
      }

      const scale = asteroidScaleAt(tier, ladder);
      onScale(scale);
      handle.tier = tier;
      // Anything just shown starts where the others are, even while they're held.
      if (landmark !== first) landmark.update(rack.time());
      rack.settle();
      showShip();
      // The label stays where it was, unless a grown landmark reaches up to it.
      labelHeight = LABEL_HEIGHT;
      if (landmark !== first) {
        landmark.group.updateWorldMatrix(true, true);
        const box = new THREE.Box3().setFromObject(landmark.group);
        const base = new THREE.Vector3().setFromMatrixPosition(holder.matrixWorld).y;
        labelHeight = Math.max(LABEL_HEIGHT, box.max.y - base + 1.7);
      }
    },
    newPiecesFor(tier) {
      if (!ladder || tier > handle.tier) return [];
      const step = LADDERS[ladder].find((s) => s.tier === tier);
      if (!step) return [];
      const groups = step.pieces.map((p) => rack.groupOf(p));
      // A stage since replaced isn't on the asteroid, so there's nothing of it to animate.
      if (step.landmarkStage && stages.get(step.landmarkStage) === landmark) {
        groups.push(landmark.group);
      }
      return groups;
    },
    update(t, timing = {}) {
      if (landmark === first) landmark.update(t);
      rack.update(t, timing);
      if (!timing.hold) {
        if (landmark !== first) landmark.update(rack.time());
        showShip();
      }
      // The asteroid keeps turning while held, so anything aimed is aimed again.
      rack.aim();
    },
    setDetail(next) {
      // The asteroid's landmark follows the same detail as its pieces.
      if (rack.setDetail(next)) rack.showDetail(landmark.group);
    },
  };
  return handle;
}

/** A module's label stays this far above the highest thing grown on it. */
const LABEL_CLEARANCE = 0.6;

/** A station module's outside growth: pieces only, with no landmark and no change of size. */
export function createModuleGrowth(id: StationModule, station: Station, kit: Kit): GrowthHandle {
  const pieces = new THREE.Group();
  pieces.name = "pieces";
  tag(pieces, id);
  station.moduleAnchors[id].add(pieces);
  const rack = createRack({
    id,
    tint: tintOf(id),
    kit,
    mountFor: () => pieces,
    place: (pieceId, group) => MODULE_PLACE[id]?.[pieceId]?.(group),
  });
  const none = new THREE.Group();
  const baseLabel = station.anchors[id].y;
  let labelHeight = baseLabel;

  const handle: GrowthHandle = {
    tier: 0,
    pieces,
    landmark: () => none,
    /** Where the label's anchor goes, in the station's coordinates. */
    labelHeight: () => labelHeight,
    setTier(wanted) {
      const tier = clampTier(wanted);
      rack.show(modulePiecesUpTo(id, tier, "outside"));
      handle.tier = tier;
      rack.settle();
      // Above whatever stays put on top (what flies about, and light, don't count).
      labelHeight = baseLabel;
      station.moduleAnchors[id].updateWorldMatrix(true, true);
      const box = new THREE.Box3();
      for (const piece of pieces.children) {
        if (FLYING.has(piece.name)) continue;
        piece.traverse((o) => {
          if (!(o as THREE.Mesh).isMesh || o.userData.reaches) return;
          box.setFromObject(o);
          labelHeight = Math.max(labelHeight, box.max.y + LABEL_CLEARANCE);
        });
      }
    },
    newPiecesFor(tier) {
      const step = LADDERS[id].find((s) => s.tier === tier);
      if (!step || step.interior || tier > handle.tier) return [];
      return step.pieces.map((p) => rack.groupOf(p));
    },
    update(t, timing = {}) {
      rack.update(t, timing);
    },
    setDetail(next) {
      rack.setDetail(next);
    },
  };
  return handle;
}

/** The growth inside a control room. */
export type InteriorGrowth = {
  tier: number;
  setTier(tier: number): void;
  /** The groups `tier` added in this room, if they're on show. */
  newPiecesFor(tier: number): THREE.Group[];
  update(t: number, timing?: PieceTiming): void;
  /** What's in the room, in the room's coordinates (ControlStation shows it). */
  pieces: THREE.Group;
  /** What's on the vault door itself, so it swings with it (VaultDoor shows it). */
  door: THREE.Group;
};

export function createInteriorGrowth(id: StationModule, tint: string, kit: Kit): InteriorGrowth {
  const pieces = new THREE.Group();
  pieces.name = "roomPieces";
  const door = new THREE.Group();
  door.name = "doorPieces";
  tag(pieces, id);
  tag(door, id);
  const rack = createRack({
    id,
    tint,
    kit,
    mountFor: (pieceId) => (pieceId === "goldVaultDoor" ? door : pieces),
  });
  const handle: InteriorGrowth = {
    tier: 0,
    pieces,
    door,
    setTier(wanted) {
      const tier = clampTier(wanted);
      rack.show(modulePiecesUpTo(id, tier, "inside"));
      handle.tier = tier;
      rack.settle();
    },
    newPiecesFor(tier) {
      const step = LADDERS[id].find((s) => s.tier === tier);
      if (!step?.interior || tier > handle.tier) return [];
      return step.pieces.map((p) => rack.groupOf(p));
    },
    update(t, timing = {}) {
      rack.update(t, timing);
    },
  };
  return handle;
}

/** Make everything under `root` clickable as its building. */
function tag(root: THREE.Object3D, id: BuildingId): void {
  root.traverse((o) => (o.userData.buildingId = id));
}
