"""Proposing what each imported side-work deposit settles.

One pure function, so every rule is tested on its own. Nothing is stored here:
the import's review screen shows these proposals and Steve confirms them.

Rules (design: docs/superpowers/specs/2026-11-18-vault-income-import-design.md):
  1. link:  within 3 days and 5% of a payment already typed in by hand.
  2. week:  an unpaid week whose landing window (plus 2 days each side) holds the
            deposit day, and whose expected pay (in CAD at that day's rate) is
            within 5% of the deposit. Closest amount wins; a tie goes to the
            earlier week; each week is used once; oldest deposits go first.
            A week with unknown expected pay is proposed only when it is the
            only week whose window fits, marked "check the amount".
  3. bonus: within 3 days of a deposit proposed as a week's pay, or of a
            payment typed in by hand.
  4. Otherwise unmatched: Steve chooses at review.
"""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Literal

from aicity.side_work_math import to_cad_cents
from aicity.statement_csv import StatementRow

WINDOW_SLACK_DAYS = 2
AMOUNT_TOLERANCE = Decimal("0.05")
BONUS_DAYS = 3


@dataclass(frozen=True)
class OpenWeek:
    schedule_id: str
    start: date
    window: tuple[date, date]
    entry_ids: list[int]
    expected_by_currency: dict[str, int]
    partial: bool


@dataclass(frozen=True)
class HandPayment:
    payment_id: int
    schedule_id: str
    received_on: date
    amount_cad_cents: int


@dataclass(frozen=True)
class Proposal:
    row: StatementRow
    kind: Literal["week", "bonus", "link", "unmatched"]
    week_start: date | None = None
    payment_id: int | None = None
    check_amount: bool = False


def _close(amount: int, target: int) -> bool:
    return target > 0 and abs(amount - target) <= AMOUNT_TOLERANCE * target


def _expected_cad(week: OpenWeek, rate: Decimal | None) -> int | None:
    if week.partial or not week.expected_by_currency:
        return None
    total = 0
    for currency, cents in week.expected_by_currency.items():
        cad = to_cad_cents(cents, currency, rate)
        if cad is None:
            return None
        total += cad
    return total


def propose(
    deposits: dict[str, list[StatementRow]],
    weeks: list[OpenWeek],
    paid: list[HandPayment],
    rate_for: Callable[[date], Decimal | None],
) -> list[Proposal]:
    proposals: list[Proposal] = []
    slack = timedelta(days=WINDOW_SLACK_DAYS)
    for schedule_id, rows in deposits.items():
        open_weeks = [w for w in weeks if w.schedule_id == schedule_id]
        hand = [p for p in paid if p.schedule_id == schedule_id]
        used_weeks: set[date] = set()
        used_hand: set[int] = set()
        pay_days: list[tuple[date, date]] = []  # (deposit day, week start) proposed as pay

        for row in sorted(rows, key=lambda r: (r.day, r.line)):
            day, amount = row.day, row.amount_cents

            link = next(
                (
                    p
                    for p in hand
                    if p.payment_id not in used_hand
                    and abs((day - p.received_on).days) <= BONUS_DAYS
                    and _close(amount, p.amount_cad_cents)
                ),
                None,
            )
            if link:
                used_hand.add(link.payment_id)
                proposals.append(Proposal(row, "link", payment_id=link.payment_id))
                continue

            fits = [
                w
                for w in open_weeks
                if w.start not in used_weeks and w.window[0] - slack <= day <= w.window[1] + slack
            ]
            rate = rate_for(day)
            known = [(w, _expected_cad(w, rate)) for w in fits]
            candidates = [(w, e) for w, e in known if e is not None and _close(amount, e)]
            if candidates:
                best, _ = min(candidates, key=lambda we: (abs(amount - we[1]), we[0].start))
                used_weeks.add(best.start)
                pay_days.append((day, best.start))
                proposals.append(Proposal(row, "week", week_start=best.start))
                continue
            if len(fits) == 1 and known[0][1] is None:
                only = fits[0]
                used_weeks.add(only.start)
                pay_days.append((day, only.start))
                proposals.append(Proposal(row, "week", week_start=only.start, check_amount=True))
                continue

            near_pay = next(
                (start for d, start in pay_days if abs((day - d).days) <= BONUS_DAYS), None
            )
            if near_pay is not None:
                proposals.append(Proposal(row, "bonus", week_start=near_pay))
                continue
            near_hand = next(
                (p for p in hand if abs((day - p.received_on).days) <= BONUS_DAYS), None
            )
            if near_hand is not None:
                proposals.append(Proposal(row, "bonus", payment_id=near_hand.payment_id))
                continue
            proposals.append(Proposal(row, "unmatched"))
    return proposals
