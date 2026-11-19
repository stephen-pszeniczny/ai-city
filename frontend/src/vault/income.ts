// Helpers for the Vault's Income screen (pure, tested in tests/income.test.ts).

import { formatCad, formatDay } from "./sideWork.ts";

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

type MainJobProposalLike = {
  kind: "link" | "new";
  pay_id: number | null;
  pay: { paid_on: string; net_cents: number } | null;
  check_amount: boolean;
};

/** The review's note on a main-job deposit the app proposes linking to typed-in pay. */
export function matchChip(p: MainJobProposalLike): string | null {
  if (p.kind !== "link" || !p.pay) return null;
  const which = `(${formatDay(p.pay.paid_on)}, ${formatCad(p.pay.net_cents)})`;
  return p.check_amount
    ? `Might be the pay you typed in ${which}: check the amount`
    : `Matches the pay you typed in ${which}`;
}

/** "$5,000": whole dollars, for the amounts under the chart's bars. */
export function wholeDollars(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString("en-CA")}`;
}

/** The amounts listed under one month's bar: stack order, empty sources left out. */
export function monthLines(
  bySource: readonly { key: string; cents: number }[],
): { key: string; text: string }[] {
  return bySource
    .filter((s) => s.cents > 0)
    .map((s) => ({ key: s.key, text: wholeDollars(s.cents) }));
}
