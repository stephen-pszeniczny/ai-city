// Display helpers for the Vault's Side work screen (pure, tested in tests/sideWork.test.ts).

import type { GroupStatus } from "../api";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function dollars(cents: number): string {
  const whole = Math.floor(Math.abs(cents) / 100).toLocaleString("en-US");
  const rest = String(Math.abs(cents) % 100).padStart(2, "0");
  return `$${whole}.${rest}`;
}

/** A CAD amount like "$1,234.50", or "rate pending" when the rate isn't known yet. */
export function formatCad(cents: number | null): string {
  return cents === null ? "rate pending" : dollars(cents);
}

/** An amount in its own currency: "$40.00" for CAD, "US$40.00" for USD. */
export function formatMoney(cents: number, currency: string): string {
  return currency === "USD" ? `US${dollars(cents)}` : dollars(cents);
}

/** Received minus expected, in words. */
export function formatDifference(cents: number | null): string {
  if (cents === null) return "";
  if (cents === 0) return "Paid in full";
  return cents < 0 ? `${dollars(cents)} short` : `${dollars(cents)} extra`;
}

// "2026-03-21" -> [3, 21], read as a calendar day (never through Date, which
// would shift it by the time zone).
function monthDay(iso: string): [number, number] {
  const [, m = 1, d = 1] = iso.split("-").map(Number);
  return [m, d];
}

/** When pay should land: "lands Mar 21–23", "lands Mar 30 – Apr 1" or "lands Mar 21". */
export function formatWindow([from, to]: [string, string]): string {
  const [m1, d1] = monthDay(from);
  const [m2, d2] = monthDay(to);
  if (from === to) return `lands ${MONTHS[m1 - 1]} ${d1}`;
  if (m1 === m2) return `lands ${MONTHS[m1 - 1]} ${d1}–${d2}`;
  return `lands ${MONTHS[m1 - 1]} ${d1} – ${MONTHS[m2 - 1]} ${d2}`;
}

/** A short calendar date: "Mar 21". */
export function formatDay(iso: string): string {
  const [m, d] = monthDay(iso);
  return `${MONTHS[m - 1]} ${d}`;
}

const STATUS: Record<GroupStatus, string> = {
  waiting: "Waiting",
  overdue: "Overdue",
  paid: "Paid",
  no_schedule: "No pay schedule",
};

export function statusLabel(status: GroupStatus): string {
  return STATUS[status];
}

/** Why typed hours won't be accepted, or null if fine (blank means unknown). */
export function hoursProblem(text: string): string | null {
  const t = text.trim();
  if (t === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return "Hours must be a number like 1.5 (up to 2 decimals).";
  const n = Number(t);
  if (n <= 0 || n > 168) return "Hours must be more than 0 and at most 168.";
  return null;
}
