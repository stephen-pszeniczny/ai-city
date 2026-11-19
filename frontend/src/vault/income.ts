// Helpers for the Vault's Income screen (pure, tested in tests/income.test.ts).

import { formatCad } from "./sideWork.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** How far this month's gross is toward the goal. The bar never overfills; the label tells. */
export function goalProgress(
  grossCents: number,
  goalCents: number,
): { percent: number; fill: number; label: string } {
  if (goalCents <= 0) return { percent: 0, fill: 0, label: "No goal set" };
  const percent = Math.round((grossCents / goalCents) * 100);
  return { percent, fill: Math.min(1, grossCents / goalCents), label: `${percent}% of goal` };
}

/** Pieces of one stacked bar, bottom up, in SVG units (y grows downwards). */
export function stackSegments(
  bySource: readonly { key: string; cents: number }[],
  scaleCents: number,
  height: number,
): { key: string; y: number; h: number }[] {
  let top = height;
  return bySource.map(({ key, cents }) => {
    const h = scaleCents > 0 ? (cents / scaleCents) * height : 0;
    top -= h;
    return { key, y: top, h };
  });
}

/** "2026-11" -> "Nov". */
export function formatMonth(month: string): string {
  const m = Number(month.split("-")[1] ?? 1);
  return MONTHS[m - 1] ?? month;
}

/** Main-job pay's label: typed in by hand until a statement deposit confirms it. */
export function payStatus(confirmed: boolean): string {
  return confirmed ? "✓ confirmed by statement" : "not yet confirmed";
}

/** At review, when linking a deposit to typed-in pay with a different amount. */
export function linkNote(depositCents: number, typedCents: number): string | null {
  if (depositCents === typedCents) return null;
  return `The statement says ${formatCad(depositCents)}; you typed ${formatCad(typedCents)}. The statement's amount will be used.`;
}
