// Draws the level-up moment (levelUpRun.ts holds it): the cargo shuttle docks, the
// robot cheers, the new pieces build themselves in, and the upgrade is saved. It
// plays only in a building's view with the camera at rest; at the Vault only once
// it's unlocked and the door greeting is over. The camera is never moved.
//
// BeltScene calls beforeUpdates() and afterUpdates() around its own frame updates:
// pieces that are building in are put back to full size before they animate.
import { useQueryClient } from "@tanstack/react-query";
import { useThree, type RootState } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import {
  getMode,
  hasVaultKey,
  markCelebrated,
  type BuildingId,
  type Mode,
  type XpView,
} from "../api";
import { VAULT_GREETING } from "../interior/stationLayout";
import { robotBrains } from "../interior/robotBrain";
import { greetingClock } from "../interior/vaultGreeting";
import { DECK_R, DECK_Y, type AsteroidBuilding } from "./asteroids";
import { FOV } from "./CameraRig";
import { createCargoShuttle, type CargoPose, type CargoShuttle } from "./CargoShuttle";
import { asteroidDock, roomDock } from "./cargoRoute";
import { flightState } from "./flightState";
import type { GrowthHandle, InteriorGrowth } from "./growth/applyGrowth";
import { createBuildIn, type BuildIn } from "./growth/buildIn";
import { asteroidScaleAt, type GrowthId } from "./growth/ladders";
import type { View } from "./levels";
import { planLevelUp } from "./levelUp";
import { celebrate, levelUp, newThings, type Ending, type Moment } from "./levelUpRun";
import { SEEN_SHARE, shareInView } from "./levelUpView";
import { LOOK } from "./look";
import { MODE_SWITCH_KEY } from "./ModeSwitch";
import { tintOf } from "./tints";

export type LevelUpWorld = {
  asteroids: AsteroidBuilding[];
  modules: Record<"planner" | "finance", GrowthHandle>;
  rooms: Record<"planner" | "finance", InteriorGrowth>;
};

type Playing = {
  moment: Moment;
  /** Where the shuttle and the glow hang: it moves with what the camera looks at. */
  root: THREE.Group;
  cargo: CargoShuttle;
  buildIn: BuildIn | null;
  cheered: boolean;
  /** Seconds since it flew off, or null while the moment runs. */
  departing: number | null;
};

// Kept, so asking each frame creates nothing.
const MODE_KEY = ["mode"];
const XP_KEY = ["xp"];
const SWITCHING = { mutationKey: MODE_SWITCH_KEY };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const smooth = (x: number) => x * x * (3 - 2 * x);

/** At the Vault: unlocked (Touch ID, in Personal mode) and the door greeting over. */
const vaultReady = (mode: Mode) =>
  (mode === "sample" || hasVaultKey()) && greetingClock(performance.now()) >= VAULT_GREETING.seated;

export function useLevelUpScene({
  world,
  view,
  reducedMotion,
  /** The development growth preview is on: nothing plays. */
  off,
}: {
  world: LevelUpWorld;
  view: View;
  reducedMotion: boolean;
  off: boolean;
}) {
  const queryClient = useQueryClient();
  const scene = useThree((s) => s.scene);
  const playing = useRef<Playing | null>(null);
  const viewRef = useRef(view);

  const drive = useMemo(() => {
    const mode = () => queryClient.getQueryData<Mode>(MODE_KEY);
    const switching = () => queryClient.isMutating(SWITCHING) > 0;
    /** The shuttle's pose, updated each frame. */
    const pose: CargoPose = { arrive: 0, tether: 0, unload: -1, depart: 0 };
    /** The camera, as it was in the last frame: for what can be seen. */
    let camera: THREE.Camera | null = null;

    const asteroidOf = (id: BuildingId) => world.asteroids.find((a) => a.id === id);
    const growthsOf = (id: BuildingId): (GrowthHandle | InteriorGrowth)[] => {
      if (id === "planner" || id === "finance") return [world.modules[id], world.rooms[id]];
      const a = asteroidOf(id);
      return a ? [a.growth] : [];
    };

    /** Put the new tier on, and return each new thing's groups by its key. */
    const showNewTier = (m: Moment) => {
      const growths = growthsOf(m.id);
      growths.forEach((g) => g.setTier(m.toTier));
      const things = newThings(m.id, m.fromTier, m.toTier);
      const groups = new Map<string, THREE.Group[]>();
      for (const thing of things) groups.set(thing.key, []);
      for (const growth of growths) {
        for (let tier = m.fromTier + 1; tier <= m.toTier; tier++) {
          const wanted = things.filter((t) => t.tier === tier);
          const made = growth.newPiecesFor(tier);
          // newPiecesFor gives a tier's pieces in ladder order, then a grown landmark.
          made.forEach((group, i) => {
            const key = group.name === "landmark" ? "landmark" : wanted[i]?.key;
            if (key) groups.get(key)?.push(group);
          });
        }
      }
      return groups;
    };

    /** Which new things the building view can't show. */
    const unseen = (id: BuildingId, groups: Map<string, THREE.Group[]>) => {
      const a = asteroidOf(id);
      const outside = id === "planner" || id === "finance" ? world.modules[id].pieces : null;
      const keys: string[] = [];
      for (const [key, list] of groups) {
        // The station's outside is hidden while the camera is in a control room.
        const hidden = list.some((g) => g.parent === outside);
        // The holder sits on the deck's top and grows with it.
        const deck = a ? { frame: a.holder, radius: DECK_R } : undefined;
        const share = hidden || !camera ? 0 : shareInView(list, camera, deck);
        if (share < SEEN_SHARE) keys.push(key);
      }
      return keys;
    };

    const remove = () => {
      const p = playing.current;
      if (!p) return;
      p.buildIn?.dispose();
      p.cargo.dispose();
      p.root.removeFromParent();
      // If it was dropped mid-build, the asteroid goes back to its tier's own size.
      const a = asteroidOf(p.moment.id);
      if (a) a.setScale(asteroidScaleAt(a.growth.tier, a.id as GrowthId));
      playing.current = null;
    };

    const onDone = (m: Moment, ending: Ending) => {
      const p = playing.current;
      const groups = showNewTier(m);
      asteroidOf(m.id)?.setScale(asteroidScaleAt(m.toTier, m.id as GrowthId));
      if (ending !== "leave") levelUp.setOffView(unseen(m.id, groups));
      p?.buildIn?.dispose();
      if (p) p.buildIn = null;
      // Run through, the shuttle flies off; skipped or left, it's simply gone.
      if (ending === "end" && p) p.departing = 0;
      else remove();
      void celebrate(m, {
        cachedMode: mode,
        switching,
        fetchMode: getMode,
        post: markCelebrated,
        refresh: () => queryClient.invalidateQueries({ queryKey: XP_KEY }),
      });
    };

    const begin = (m: Moment, aspect: number) => {
      remove();
      const root = new THREE.Group();
      root.name = "levelUp";
      const a = asteroidOf(m.id);
      let dock;
      if (a) {
        // In deck coordinates, turning with the asteroid, as the camera does.
        root.position.y = DECK_Y;
        a.spin.add(root);
        dock = asteroidDock(
          a.id,
          FOV.inside,
          aspect,
          asteroidScaleAt(m.fromTier, a.id as GrowthId),
        );
      } else {
        // In the world: the station's outside is hidden while the camera is inside.
        scene.add(root);
        dock = roomDock(m.id as "planner" | "finance", FOV.inside, aspect);
      }
      const cargo = createCargoShuttle(dock, tintOf(m.id));
      root.add(cargo.group);
      playing.current = {
        moment: m,
        root,
        cargo,
        buildIn: null,
        cheered: false,
        departing: null,
      };
    };

    const startBuild = (p: Playing, m: Moment) => {
      const groups = showNewTier(m);
      levelUp.setOffView(unseen(m.id, groups));
      const roomOnly = m.id === "planner" || m.id === "finance";
      const outside = roomOnly ? world.modules[m.id as "planner"].pieces : null;
      // Nothing glows for what's hidden outside the station.
      const shown = [...groups.values()].flat().filter((g) => g.parent !== outside);
      p.buildIn = createBuildIn(shown, p.root, tintOf(m.id));
    };

    /** Between moments: start the next one once it has been due for a moment. */
    const waitForOne = (state: RootState, delta: number) => {
      const last = levelUp.last();
      if (last && mode() !== last.mode) levelUp.abandon();
      const here = viewRef.current;
      if (off || here.level !== "building") {
        levelUp.settle(null, delta);
        return;
      }
      const current = mode();
      const building = queryClient
        .getQueryData<XpView>(XP_KEY)
        ?.buildings.find((b) => b.id === here.id);
      const ready =
        !!current &&
        !switching() &&
        !flightState.flying() &&
        (here.id !== "finance" || vaultReady(current));
      const plan = building ? planLevelUp(building, here, ready) : null;
      // Already played this session (not refetched yet, or the save failed): nothing due.
      const due =
        plan && current && levelUp.playedTier(current, plan.id) < plan.toTier ? plan : null;
      if (!levelUp.settle(due, delta) || !due || !current) return;
      levelUp.start(due, current, { reducedMotion, onDone });
      const started = levelUp.running();
      if (started) begin(started, state.size.width / state.size.height);
    };

    const frame = (state: RootState, delta: number) => {
      camera = state.camera;
      const now = state.clock.elapsedTime;
      let m = levelUp.running();
      if (m && (switching() || mode() !== m.mode)) {
        // The other mode's data: drop it, and save nothing.
        levelUp.abandon();
        remove();
        m = null;
      }
      if (!m) waitForOne(state, delta);
      levelUp.advance(delta);
      const p = playing.current;
      if (!p) return;
      const { dockSeconds, cheerSeconds, departSeconds } = LOOK.growth.moment;
      const running = levelUp.running();
      if (!running) {
        if (p.departing === null) return remove();
        p.departing += Math.min(delta, 0.1);
        const depart = p.departing / departSeconds;
        if (depart >= 1) return remove();
        pose.arrive = pose.tether = 1;
        pose.unload = -1;
        pose.depart = depart;
        p.cargo.update(now, pose);
        return;
      }
      const t = levelUp.elapsed();
      if (running.phase !== "dock" && !p.cheered) {
        p.cheered = true;
        robotBrains.get(running.id)?.force("cheer");
      }
      let built = 0;
      if (running.phase === "build") {
        if (!p.buildIn) startBuild(p, running);
        built = clamp01((t - dockSeconds - cheerSeconds) / LOOK.growth.buildInSeconds);
        p.buildIn?.apply(built);
        const a = asteroidOf(running.id);
        if (a) {
          // The asteroid grows along with the new pieces instead of jumping.
          const id = a.id as GrowthId;
          const from = asteroidScaleAt(running.fromTier, id);
          a.setScale(from + (asteroidScaleAt(running.toTier, id) - from) * smooth(built));
        }
      }
      pose.arrive = t / (dockSeconds * 0.85);
      pose.tether = (t - dockSeconds * 0.8) / 0.5;
      pose.unload = running.phase === "build" ? built : -1;
      pose.depart = 0;
      p.cargo.update(now, pose);
    };

    return {
      beforeUpdates: () => playing.current?.buildIn?.restore(),
      afterUpdates: frame,
      remove,
    };
  }, [world, scene, queryClient, reducedMotion, off]);

  // Leaving the building mid-moment still ends it at done. A layout effect, so it
  // happens before the next frame is drawn.
  useLayoutEffect(() => {
    viewRef.current = view;
    levelUp.releaseClick();
    const here = view.level === "building" ? view.id : null;
    const m = levelUp.running() ?? levelUp.last();
    if (m && m.id !== here) levelUp.finish("leave");
    if (playing.current && playing.current.moment.id !== here) drive.remove();
  }, [view, drive]);

  // The scene going away is leaving too.
  useEffect(
    () => () => {
      levelUp.finish("leave");
      drive.remove();
    },
    [drive],
  );

  return drive;
}
