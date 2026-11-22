// Opportunity Office's small display rules (pure, so they're tested on their own).

const FORWARD = ["found", "applied", "assessment", "accepted", "active", "ended"];
const CAN_REJECT = ["found", "applied", "assessment", "accepted"];

/** Where a logged project can move next: any later step, or rejected before it's active. */
export function nextProjectStatuses(status: string): string[] {
  if (status === "rejected" || status === "ended") return [];
  const at = FORWARD.indexOf(status);
  const later = at < 0 ? [] : FORWARD.slice(at + 1);
  return CAN_REJECT.includes(status) ? [...later, "rejected"] : later;
}

/** "Due today", "Due tomorrow", "Due in 3 days", or "—" for a platform never checked. */
export function checkLabel(card: { next_check_on: string | null }, today: string): string {
  if (card.next_check_on === null) return "—";
  const days = Math.round(
    (Date.parse(`${card.next_check_on}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000,
  );
  if (days <= 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
}

type Pay = {
  pay_cents: number | null;
  currency: string | null;
  pay_usd_cents: number | null;
  pay_cad_cents: number | null;
};

function dollars(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;
}

/** "$45 USD/hr · $61.20 CAD": the logged pay, then the other currency when the rate is known. */
export function payText(p: Pay): string {
  if (p.pay_cents === null || p.currency === null) return "Pay not set";
  const main = `${dollars(p.pay_cents)} ${p.currency}/hr`;
  const other = p.currency === "USD" ? p.pay_cad_cents : p.pay_usd_cents;
  const otherCurrency = p.currency === "USD" ? "CAD" : "USD";
  return other === null ? main : `${main} · ${dollars(other)} ${otherCurrency}`;
}
