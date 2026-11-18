// What the Sample | Personal switch says and allows, kept apart from React so it can be tested.
import type { Mode } from "../api";

export type SwitchState = {
  /** The mode the backend last confirmed, or undefined while unknown. */
  mode: Mode | undefined;
  /** The mode a switch is on its way to, or null when nothing is happening. */
  pendingTo: Mode | null;
};

/** Short status line shown under the switch while it works, or null. */
export function switchStatus({ pendingTo }: SwitchState): string | null {
  if (pendingTo === "personal") return "Waiting for Touch ID…";
  if (pendingTo === "sample") return "Switching to Sample…";
  return null;
}

/**
 * Whether a button can be pressed: not while a switch is under way,
 * not while the mode is unknown, and not for the mode already in use.
 */
export function canSwitchTo(target: Mode, { mode, pendingTo }: SwitchState): boolean {
  return pendingTo === null && mode !== undefined && mode !== target;
}
