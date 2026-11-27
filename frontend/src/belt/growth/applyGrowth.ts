// Puts an asteroid at an upgrade tier: adds or removes its pieces, swaps the
// landmark's stage and sets how big the asteroid is. Pieces are built the first
// time they're shown and kept, so going back and forth builds nothing twice; the
// kit frees them all. Unbuilt asteroids don't grow.
import * as THREE from "three";

import type { BuildingId } from "../../api";
import { WORK_AT, WORK_SCALE } from "../../interior/workspace.ts";
import { createLandmark } from "../landmarks.ts";
import type { Detail } from "../lod.ts";
import { LOOK } from "../look.ts";
import type { Kit } from "../materials.ts";
import type { Ground } from "./ground.ts";
import {
  asteroidScaleAt,
  LADDERS,
  landmarkStageAt,
  piecesUpTo,
  type LandmarkStage,
} from "./ladders.ts";
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
   * Animate: the landmark at time t; the pieces too unless `hold` (the computer
   * screen is open). `motion` slows the pieces for reduced motion.
   */
  update(t: number, o?: { hold?: boolean; motion?: number }): void;
  /** Far away, small details are left out (see lod.ts). */
  setDetail(detail: Detail): void;
  /** How high over the deck the building's label needs to be. */
  labelHeight(): number;
  /** The landmark on show. */
  landmark(): THREE.Group;
  /** The asteroid's pieces on show, one child each, in ladder order. */
  pieces: THREE.Group;
};

type Model = { group: THREE.Group; update(t: number): void };

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

  const stages = new Map<LandmarkStage, Model>([[1, first]]);
  first.group.name = "landmark";
  first.group.userData.stage = 1;
  tag(first.group, id);
  let landmark = first;
  const made = new Map<string, Piece>();
  let shown: Piece[] = [];
  let detail: Detail = "near";
  let labelHeight = LABEL_HEIGHT;

  const showDetail = (root: THREE.Object3D) =>
    root.traverse((o) => {
      if (o.userData.nearOnly) o.visible = detail === "near";
    });
  /** The ship on its pad hides while its flying copy is away. */
  const showShip = () => {
    const ship = landmark.group.getObjectByName("ship");
    if (ship) ship.visible = !shown.some((p) => p.away?.());
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
      const tier = Math.min(10, Math.max(0, Math.round(wanted)));
      const ids = piecesUpTo(ladder, tier);
      for (const group of [pieces, onDesk]) group.clear();
      shown = ids.map((pieceId) => {
        let piece = made.get(pieceId);
        if (!piece) {
          piece = createPiece(pieceId, tint, kit, ground);
          tag(piece.group, id);
          made.set(pieceId, piece);
        }
        (DESK_PIECES.has(pieceId) ? onDesk : pieces).add(piece.group);
        showDetail(piece.group);
        return piece;
      });

      const next = stageModel(landmarkStageAt(ladder, tier), ladder);
      if (next !== landmark) {
        holder.remove(landmark.group);
        holder.add(next.group);
        landmark = next;
        landmark.update(0);
        showDetail(landmark.group);
      }
      showShip();

      const scale = asteroidScaleAt(tier, ladder);
      onScale(scale);
      handle.tier = tier;
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
      const groups = step.pieces.map((p) => made.get(p)!.group);
      if (step.landmarkStage) groups.push(stageModel(step.landmarkStage, ladder).group);
      return groups;
    },
    update(t, { hold = false, motion = 1 } = {}) {
      landmark.update(t);
      if (hold) return;
      const time = t * motion * LOOK.growth.pieceMotion;
      for (const piece of shown) piece.update(time);
      showShip();
    },
    setDetail(next) {
      if (next === detail) return;
      detail = next;
      for (const root of [pieces, onDesk, landmark.group]) showDetail(root);
    },
  };
  return handle;
}

/** Make everything under `root` clickable as its building. */
function tag(root: THREE.Object3D, id: BuildingId): void {
  root.traverse((o) => (o.userData.buildingId = id));
}
