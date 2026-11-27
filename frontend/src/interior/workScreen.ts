// What a robot's screen shows while it works: tabs, progress bars, a scrolling
// log and a small chart that move on as the robot types and switches tabs
// (the robot's `tick`). Lines are generic on purpose: never personal data or
// amounts. Built buildings also carry a live view of their real counts (liveStat).
import type { BuildingId } from "../api";
import type { LiveStat } from "./liveStat";

export type WorkScreen = {
  tabs: string[];
  active: number;
  /** Three progress bars, 0 to 1. */
  progress: number[];
  /** Latest log lines, oldest first. */
  log: string[];
  /** Twelve chart values, 0 to 1. */
  chart: number[];
  /** The building's live counts (never names or amounts), or null. */
  live: LiveStat | null;
  /** The building isn't built yet: the screen says so. */
  construction: boolean;
};

const BUILT_TABS: Partial<Record<BuildingId, string[]>> = {
  planner: ["Today", "To-do", "Reminders"],
};

const LOGS: Record<BuildingId, string[]> = {
  planner: [
    "Checked tasks for stale items",
    "Sorted the list by goal date",
    "Reminder queue refreshed",
    "Categories counted",
    "Weekly review notes drafted",
    "History saved",
  ],
  finance: [
    "Drawing the income cards",
    "Laying out the pay check view",
    "Wiring the set-aside meter",
    "Testing currency conversion",
    "Planning deposit matching",
  ],
  jobs: [
    "Checking platform statuses",
    "Counting platforms due a check",
    "Stamping check dates",
    "Tidying the project log",
    "Comparing pay with the floor",
  ],
  career: [
    "Mapping the skills gap view",
    "Planning study tracks",
    "Designing the archive",
    "Fuelling the training rocket",
  ],
  mail: [
    "Planning label rules",
    "Designing summaries",
    "Sorting the mail tubes",
    "Testing the cleanup label",
  ],
  relationships: [
    "Planning the birthday board",
    "Designing check-in reminders",
    "Sketching gift idea cards",
  ],
  projects: [
    "Laying the keel of the roadmap",
    "Designing the blockers board",
    "Planning next-step cards",
  ],
  gym: ["Racking the weights", "Designing the lift log", "Planning progress charts"],
  library: ["Indexing the shelves", "Designing note links", "Growing data crystals"],
};

const LOG_LINES = 5;

export function workScreen(
  id: BuildingId,
  built: boolean,
  tick: number,
  live: LiveStat | null = null,
): WorkScreen {
  const tabs = built
    ? (BUILT_TABS[id] ?? ["Overview", "Activity"])
    : ["Setting up", "Blueprint", "Checklist"];
  const active = Math.floor(tick / 4) % tabs.length;
  const pool = LOGS[id];
  const log: string[] = [];
  for (let i = LOG_LINES - 1; i >= 0; i--) {
    const n = tick - i;
    if (n < 0) continue;
    log.push(pool[n % pool.length] ?? "");
  }
  const frac = (x: number) => x - Math.floor(x);
  return {
    tabs,
    active,
    progress: [0, 1, 2].map((i) => frac(tick * 0.07 + i * 0.31)),
    log,
    chart: Array.from({ length: 12 }, (_, i) => 0.5 + 0.4 * Math.sin((tick + i) * 0.7 + i * 0.3)),
    live: built ? live : null,
    construction: !built,
  };
}
