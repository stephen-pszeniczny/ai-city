// Running a level-up moment (levelUp.ts says when one is due). The running moment
// is held here, outside React: nothing that re-renders or refetches XP can restart
// it. Each upgrade plays once per mode in a session, even if saving it failed.
// A click, Escape or leaving the building ends it at done. Pure logic; the scene
// draws it (useLevelUpScene.ts).
import type { BuildingId, Mode } from "../api";
import { LADDERS, type GrowthId } from "./growth/ladders.ts";
import { phaseAt, type LevelUpPhase, type LevelUpPlan } from "./levelUp.ts";
import { LANDMARK_NAMES, PIECE_NAMES } from "./levelUpNames.ts";
import { LOOK } from "./look.ts";

/** One upgrade playing (or just played), with the mode whose data it belongs to. */
export type Moment = {
  id: BuildingId;
  fromTier: number;
  toTier: number;
  mode: Mode;
  phase: LevelUpPhase;
};

/** How a moment ended: it ran through, it was clicked or Escaped, or the building was left. */
export type Ending = "end" | "skip" | "leave";

export type Snapshot = {
  running: Moment | null;
  /** The moment that just ended inside its building, for the card naming what's new. */
  last: Moment | null;
  /** The new things (newThings keys) that can't be seen from the building view. */
  offView: readonly string[];
};

/** The longest one frame counts for, so a hitch (or a hidden tab) skips nothing. */
const LONGEST_STEP = 0.1;
const NOTHING: Snapshot = { running: null, last: null, offView: [] };

export class LevelUpRunner {
  private state = NOTHING;
  private seconds = 0;
  private settled = 0;
  private swallow = false;
  private onDone: ((moment: Moment, ending: Ending) => void) | null = null;
  /** The newest tier played this session, by mode and building. */
  private readonly played = new Map<string, number>();
  private readonly listeners = new Set<() => void>();

  snapshot = (): Snapshot => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  running = (): Moment | null => this.state.running;
  last = (): Moment | null => this.state.last;
  /** Seconds into the running moment. */
  elapsed = (): number => this.seconds;

  playedTier(mode: Mode | undefined, id: BuildingId): number {
    return mode ? (this.played.get(`${mode}:${id}`) ?? 0) : 0;
  }

  /** The tier the scene shows: the old one until the build, then the new one from then on. */
  shownTier(mode: Mode | undefined, id: BuildingId, serverTier: number): number {
    const m = this.state.running;
    if (m && m.mode === mode && m.id === id) {
      return m.phase === "dock" || m.phase === "cheer" ? m.fromTier : m.toTier;
    }
    return Math.max(serverTier, this.playedTier(mode, id));
  }

  /** Call each frame with what's due. True once it has been due long enough to start. */
  settle(plan: LevelUpPlan, dt: number): boolean {
    if (!plan || this.state.running) this.settled = 0;
    else this.settled += Math.min(dt, LONGEST_STEP);
    return this.settled >= LOOK.growth.moment.settleSeconds - 1e-9;
  }

  /**
   * Play `plan`, unless a moment is running or this upgrade has played. With reduced
   * motion it goes straight to done.
   */
  start(
    plan: NonNullable<LevelUpPlan>,
    mode: Mode,
    o: { reducedMotion: boolean; onDone: (moment: Moment, ending: Ending) => void },
  ): boolean {
    const played = this.playedTier(mode, plan.id);
    if (this.state.running || played >= plan.toTier) return false;
    this.seconds = 0;
    this.settled = 0;
    this.onDone = o.onDone;
    const fromTier = Math.max(plan.fromTier, played);
    this.set({ ...NOTHING, running: { ...plan, fromTier, mode, phase: "dock" } });
    if (o.reducedMotion) this.finish("skip");
    return true;
  }

  advance(dt: number): void {
    const m = this.state.running;
    if (!m) return;
    this.seconds += Math.min(dt, LONGEST_STEP);
    const phase = phaseAt(this.seconds);
    if (phase === "done") this.finish("end");
    else if (phase !== m.phase) this.set({ ...this.state, running: { ...m, phase } });
  }

  /** Go to done now (once): the end state shows and the upgrade counts as played. */
  finish(ending: Ending): void {
    const m = this.state.running;
    if (!m) {
      if (ending === "leave") this.clearLast();
      return;
    }
    const done: Moment = { ...m, phase: "done" };
    this.played.set(`${m.mode}:${m.id}`, m.toTier);
    const onDone = this.onDone;
    this.onDone = null;
    this.set({
      running: null,
      last: ending === "leave" ? null : done,
      offView: this.state.offView,
    });
    onDone?.(done, ending);
  }

  /** The data changed under it (a mode switch): drop it without counting it as played. */
  abandon(): void {
    this.onDone = null;
    this.settled = 0;
    if (this.state !== NOTHING) this.set(NOTHING);
  }

  /** Put the card away. */
  clearLast(): void {
    if (this.state.last) this.set({ ...this.state, last: null });
  }

  setOffView(keys: readonly string[]): void {
    if (keys.join() !== this.state.offView.join()) this.set({ ...this.state, offView: keys });
  }

  /** A press on the 3D page. During a moment it skips it, and its click does nothing else. */
  pointerDown(): void {
    this.swallow = this.state.running !== null;
    if (this.swallow) this.finish("skip");
  }

  swallowsClick(): boolean {
    return this.swallow;
  }

  /** The view changed: whatever comes next wasn't the click that skipped. */
  releaseClick(): void {
    this.swallow = false;
  }

  private set(next: Snapshot): void {
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }
}

/** The one runner the scene, the page and the XP bar share. */
export const levelUp = new LevelUpRunner();

/** Something new with an upgrade: a piece, or the landmark growing. */
export type NewThing = { key: string; tier: number; label: string };

/** Everything new from the tier after `fromTier` up to `toTier`, oldest first. */
export function newThings(id: BuildingId, fromTier: number, toTier: number): NewThing[] {
  const ladder = LADDERS[id as GrowthId] ?? [];
  const landmark = LANDMARK_NAMES[id as GrowthId];
  const steps = ladder.filter((s) => s.tier > fromTier && s.tier <= toTier);
  const things: NewThing[] = steps.flatMap((step) =>
    step.pieces.map((p) => ({ key: p, tier: step.tier, label: PIECE_NAMES[p] })),
  );
  // Only the newest landmark stage is ever on show.
  const grown = steps.filter((s) => s.landmarkStage).at(-1);
  if (grown && landmark) things.push({ key: "landmark", tier: grown.tier, label: landmark });
  return things;
}

/**
 * Save that a moment was played, then refetch XP. Nothing is sent unless the app is
 * still in the moment's mode (the request itself carries no mode): not during a
 * switch, and not if the engine now says another mode. A failure is harmless: it
 * isn't replayed this session, and plays again after a reload.
 */
export async function celebrate(
  moment: Moment,
  deps: {
    cachedMode(): Mode | undefined;
    switching(): boolean;
    fetchMode(): Promise<Mode>;
    post(id: BuildingId, tier: number): Promise<unknown>;
    refresh(): Promise<unknown>;
  },
): Promise<void> {
  const sameMode = () => !deps.switching() && deps.cachedMode() === moment.mode;
  if (!sameMode()) return;
  try {
    // Asked afresh, in case another window switched.
    if ((await deps.fetchMode()) !== moment.mode || !sameMode()) return;
  } catch {
    return;
  }
  await deps.post(moment.id, moment.toTier).catch(() => {});
  await deps.refresh();
}
