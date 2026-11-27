// What a robot is doing right now. Not a fixed loop: when an action ends the
// next one is picked at random (weighted, so typing is still the most common),
// never the same action twice in a row, with a random length. Clicking the
// robot makes it wave or spin next. Pure logic, so it can be tested.
import type { BuildingId } from "../api";

export type RobotAction =
  | "type"
  | "switchTab"
  | "read"
  | "sip"
  | "stretch"
  | "lookAround"
  | "spin"
  | "wave"
  | "gadget"
  /** The level-up moment only: never picked at random (see force). */
  | "cheer";

/** Shortest and longest length of each action, in seconds (before busyness). */
export const DURATIONS: Record<RobotAction, readonly [number, number]> = {
  type: [3, 7],
  switchTab: [1.2, 2],
  read: [2, 4],
  sip: [2, 3],
  lookAround: [1.5, 3],
  gadget: [2, 4],
  stretch: [2, 3],
  spin: [2.2, 3],
  wave: [1.8, 2.5],
  cheer: [2.6, 2.6],
};

const WORK_WEIGHTS: [RobotAction, number][] = [
  ["type", 5],
  ["switchTab", 2],
  ["read", 2],
  ["sip", 1],
  ["lookAround", 1],
  ["gadget", 1],
];
const FUN: RobotAction[] = ["stretch", "spin", "wave"];

/** Seconds of typing per screen update (a new log line or value). */
const TYPE_STEP = 0.6;

/** A small, fast, seeded random number generator: same seed, same numbers. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type RobotState = {
  action: RobotAction;
  /** 0 at the start of the action, 1 at its end. */
  progress: number;
  /** Goes up each time the screen should change (typing steps, tab switches). */
  tick: number;
};

export class RobotBrain {
  /** How many times the action has changed (for tests and the screen). */
  changes = 0;
  /** A per-robot time offset (seconds) so blinks and idle motions aren't in sync. */
  readonly seedOffset: number;
  /** The state from the latest update (the screen reads this). */
  last: RobotState = { action: "type", progress: 0, tick: 0 };
  private readonly rng: () => number;
  private readonly weights: [RobotAction, number][];
  private readonly busyness: number;
  private action: RobotAction = "type";
  private start = 0;
  private length = 1;
  private tickBase = 0;
  private started = false;
  private reactNext = false;
  private forced: RobotAction | null = null;

  constructor(seed: number, opts: { funShare?: number; busyness?: number } = {}) {
    this.rng = mulberry32(seed);
    this.seedOffset = this.rng() * 10;
    this.busyness = opts.busyness ?? 1;
    const funShare = Math.min(0.9, Math.max(0, opts.funShare ?? 0.15));
    const work = WORK_WEIGHTS.reduce((s, [, w]) => s + w, 0);
    const funEach = (work * funShare) / (1 - funShare) / FUN.length;
    this.weights = [...WORK_WEIGHTS, ...FUN.map((a): [RobotAction, number] => [a, funEach])];
  }

  /** Make the robot do `action` next (the vault greeting's wave, a level-up's cheer). */
  force(action: RobotAction): void {
    this.forced = action;
  }

  /** Ask the robot to react (it was clicked): it waves or spins next. */
  react(): void {
    this.reactNext = true;
  }

  update(t: number): RobotState {
    if (!this.started) {
      this.started = true;
      this.begin(this.pick(null), t);
    } else if (this.forced) {
      const next = this.forced;
      this.forced = null;
      this.switchTo(next, t);
    } else if (this.reactNext) {
      this.reactNext = false;
      this.switchTo(this.action === "wave" ? "spin" : this.rng() < 0.5 ? "wave" : "spin", t);
    } else if (t - this.start >= this.length) {
      // Only one change per call, however long the gap (a tab hidden for minutes).
      this.switchTo(this.pick(this.action), t);
    }
    const elapsed = Math.max(0, t - this.start);
    this.last = {
      action: this.action,
      progress: Math.min(1, elapsed / this.length),
      tick: this.currentTick(elapsed),
    };
    return this.last;
  }

  private currentTick(elapsed: number): number {
    if (this.action !== "type") return this.tickBase;
    return this.tickBase + Math.floor(Math.min(elapsed, this.length) / TYPE_STEP);
  }

  private switchTo(next: RobotAction, t: number) {
    this.tickBase = this.currentTick(t - this.start);
    if (next === "switchTab") this.tickBase += 1;
    this.changes++;
    this.begin(next, t);
  }

  private begin(action: RobotAction, t: number) {
    const [min, max] = DURATIONS[action];
    this.action = action;
    this.start = t;
    const length = min + (max - min) * this.rng();
    // A cheer is timed to the level-up moment, however busy the robot is.
    this.length = action === "cheer" ? length : length / this.busyness;
  }

  /** A weighted random action, never the same as `previous`. */
  private pick(previous: RobotAction | null): RobotAction {
    const options = this.weights.filter(([a]) => a !== previous);
    const total = options.reduce((s, [, w]) => s + w, 0);
    let r = this.rng() * total;
    for (const [a, w] of options) {
      r -= w;
      if (r <= 0) return a;
    }
    return options[options.length - 1]?.[0] ?? "type";
  }
}

/** Each building's robot, while it's on screen, so the level-up moment can make it cheer. */
export const robotBrains = new Map<BuildingId, RobotBrain>();
