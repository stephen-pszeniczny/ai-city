// Day and night mode rules (SPEC section 7, "The belt"): the sky override, when to
// ask the backend again, and the fade between the two looks. No 3D in here.
//
// The override lives in this browser's storage: a per-viewer convenience. Storage
// can be blocked or hold anything, so every read and write is guarded and falls
// back to Auto.
import type { Daylight } from "../api";

export type SkyChoice = "auto" | "day" | "night";

export const CHOICE_LABELS: Record<SkyChoice, string> = {
  auto: "Auto",
  day: "Day",
  night: "Night",
};

/** The switch's segments, in the order shown. */
export const SKY_CHOICES: readonly SkyChoice[] = ["day", "night", "auto"];

const STORAGE_KEY = "aicity.sky";
const MIN_REFRESH_MS = 60_000; // one minute
const MAX_REFRESH_MS = 6 * 3_600_000; // six hours

/** Auto follows the backend; with no answer (engine down) it shows day. */
export function isNight(choice: SkyChoice, daylight: Daylight | undefined): boolean {
  if (choice === "day") return false;
  if (choice === "night") return true;
  return daylight?.is_night ?? false;
}

export function loadChoice(storage: Pick<Storage, "getItem"> | null): SkyChoice {
  try {
    const saved = storage?.getItem(STORAGE_KEY);
    return SKY_CHOICES.includes(saved as SkyChoice) ? (saved as SkyChoice) : "auto";
  } catch {
    return "auto";
  }
}

export function saveChoice(storage: Pick<Storage, "setItem"> | null, c: SkyChoice): void {
  try {
    storage?.setItem(STORAGE_KEY, c);
  } catch {
    // Not remembered this time; the choice still applies until the page reloads.
  }
}

/**
 * How long to wait before asking the backend again. A change already past (the
 * Mac slept through it) or an unreadable time asks again in a minute; a far one
 * still checks every six hours.
 */
export function msUntilRefresh(nextChange: string, nowMs: number): number {
  const wait = Date.parse(nextChange) - nowMs;
  if (Number.isNaN(wait)) return MIN_REFRESH_MS;
  return Math.min(MAX_REFRESH_MS, Math.max(MIN_REFRESH_MS, wait));
}

/** True once the backend's next change has passed (e.g. the Mac slept through sunset). */
export function isPastChange(nextChange: string, nowMs: number): boolean {
  const at = Date.parse(nextChange);
  return !Number.isNaN(at) && nowMs >= at;
}

/**
 * How long a change should fade: quick when the Sky choice itself changed (a button
 * press), slow when the choice is the same and the backend's answer changed (sunrise
 * or sunset).
 */
export function fadeSecondsFor(
  lastChoice: SkyChoice,
  choice: SkyChoice,
  look: { fadeSeconds: number; buttonFadeSeconds: number },
): number {
  return lastChoice === choice ? look.fadeSeconds : look.buttonFadeSeconds;
}

/** Eased fade from `from` to `to` over `fadeS` seconds. */
export function blend(from: number, to: number, elapsedS: number, fadeS: number): number {
  if (fadeS <= 0) return to;
  const x = Math.min(1, Math.max(0, elapsedS / fadeS));
  return from + (to - from) * x * x * (3 - 2 * x);
}
