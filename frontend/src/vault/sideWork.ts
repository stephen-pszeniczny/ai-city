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

const MAX_HOURS = 168;

/**
 * Hours and minutes typed in two boxes, as the decimal hours the engine stores (up to
 * 2 decimals, so 20 min is "0.33"). Both blank means unknown (allowed).
 */
export function combineTime(
  hoursText: string,
  minutesText: string,
): { value: string | null; problem: string | null } {
  const h = hoursText.trim();
  const m = minutesText.trim();
  if (h === "" && m === "") return { value: null, problem: null };
  const whole = /^\d+$/;
  if ((h !== "" && !whole.test(h)) || (m !== "" && !whole.test(m)) || Number(m || 0) > 59) {
    return { value: null, problem: "Whole hours and 0–59 minutes" };
  }
  const total = Math.round((Number(h || 0) + Number(m || 0) / 60) * 100) / 100;
  if (total <= 0 || total > MAX_HOURS) return { value: null, problem: "Over 0 and at most 168 h" };
  return { value: String(total), problem: null };
}

/** Saved decimal hours as "1 h 10 min", "45 min" or "2 h"; unknown is "time ?". */
export function formatTime(hours: string | null): string {
  if (hours === null) return "time ?";
  const totalMinutes = Math.round(Number(hours) * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
