"""The Vault's Income screen and its belt badge.

Gross counts the main job's gross pay (its net when the gross isn't typed in yet,
flagged) plus side income received. Net beside it is the main job's net plus
side income less its tax set-aside. The employer RRSP match is shown apart and
never counts toward the goal. The badge shows counts only, never amounts.
"""

import sqlite3
from datetime import date
from decimal import Decimal

from aicity.income import IncomeStore, MainJobPayRow
from aicity.settings import IncomeSettings, PaySchedule
from aicity.side_work import SideWorkStore
from aicity.side_work_math import hourly_rate_cents, is_overdue, set_aside_cents, to_cad_cents
from aicity.statement_import import open_weeks

MONTHS_SHOWN = 6
PLATFORM_MONTHS = 3


def _month(d: date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def _months_back(today: date, count: int) -> list[str]:
    y, m = today.year, today.month
    out = []
    for _ in range(count):
        out.append(f"{y:04d}-{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return list(reversed(out))


def _first_of_month_back(today: date, months: int) -> date:
    y, m = today.year, today.month - months
    while m <= 0:
        y, m = y - 1, m + 12
    return date(y, m, 1)


def income_view(
    conn: sqlite3.Connection,
    side: SideWorkStore,
    income: IncomeStore,
    goal_cents: int,
    settings: IncomeSettings,
    schedules: dict[str, PaySchedule],
    main_job_name: str | None,
    today: date,
    *,
    goal_split: tuple[int, int] | None = None,
) -> dict:
    """The Income screen. goal_split is (main job, side income) goals, when set."""
    del conn  # the stores carry the connection
    names = {"main_job": main_job_name or "Main job", "extra": "Other side income"}
    names |= {s.id: s.name for s in schedules.values()}
    gross: dict[str, dict[str, int]] = {}  # month -> source -> cents
    side_month: dict[str, int] = {}
    main_net: dict[str, int] = {}
    match: dict[str, int] = {}
    missing_gross: set[str] = set()

    def add(month: str, key: str, cents: int) -> None:
        gross.setdefault(month, {})
        gross[month][key] = gross[month].get(key, 0) + cents

    pay_rows = income.main_job_pay()
    for row in pay_rows:
        m = _month(row.paid_on)  # the typed date, even when the deposit came a day early
        if row.gross_cents is None:
            missing_gross.add(m)
        add(m, "main_job", row.gross_cents if row.gross_cents is not None else row.net_cents)
        main_net[m] = main_net.get(m, 0) + row.net_cents
        match[m] = match.get(m, 0) + (row.match_cents or 0)

    payments = side.payments()
    year_side = 0
    for p in payments:
        cad = to_cad_cents(p.amount_cents, p.currency, p.rate)
        if cad is None:
            continue
        m = _month(p.received_on)
        key = p.company if (p.kind != "extra" and p.company in schedules) else "extra"
        add(m, key, cad)
        side_month[m] = side_month.get(m, 0) + cad
        if p.received_on.year == today.year:
            year_side += cad

    this = _month(today)
    month_sources = gross.get(this, {})
    side_now = side_month.get(this, 0)
    by_source = [
        {"key": k, "name": names.get(k, k), "cents": v} for k, v in sorted(month_sources.items())
    ]

    # Side work by platform over the last few months: hours of paid weeks and what they paid.
    since = _first_of_month_back(today, PLATFORM_MONTHS - 1)
    entries_by_payment: dict[int, int] = {}
    for e in side.entries():
        if e.payment_id is not None and e.hundredths is not None:
            entries_by_payment[e.payment_id] = (
                entries_by_payment.get(e.payment_id, 0) + e.hundredths
            )
    platforms = []
    for s in schedules.values():
        received = hundredths = 0
        for p in payments:
            if p.company != s.id or p.kind == "extra" or p.received_on < since:
                continue
            cad = to_cad_cents(p.amount_cents, p.currency, p.rate)
            if cad is None:
                continue
            received += cad
            hundredths += entries_by_payment.get(p.id, 0)
        if received or hundredths:
            platforms.append(
                {
                    "id": s.id,
                    "name": s.name,
                    "hours": format((Decimal(hundredths) / 100).normalize(), "f"),
                    "received_cad_cents": received,
                    "rate_cad_cents": hourly_rate_cents(received, hundredths),
                }
            )

    return {
        "month": {
            "month": this,
            "gross_cents": sum(month_sources.values()),
            "net_cents": main_net.get(this, 0)
            + side_now
            - set_aside_cents(side_now, settings.tax_set_aside_percent),
            "gross_missing": this in missing_gross,
            "goal_cents": goal_cents,
            "employer_match_cents": match.get(this, 0),
            "main_job_gross_cents": month_sources.get("main_job", 0),
            "side_gross_cents": side_now,
            "goal_split": None
            if goal_split is None
            else {"main_job_cents": goal_split[0], "side_income_cents": goal_split[1]},
            "by_source": by_source,
        },
        "months": [
            {
                "month": m,
                "by_source": [
                    {"key": k, "name": names.get(k, k), "cents": v}
                    for k, v in sorted(gross.get(m, {}).items())
                ],
                "total_cents": sum(gross.get(m, {}).values()),
            }
            for m in _months_back(today, MONTHS_SHOWN)
        ],
        "platforms": platforms,
        "set_aside": {
            "cents": set_aside_cents(year_side, settings.tax_set_aside_percent),
            "percent": format(settings.tax_set_aside_percent.normalize(), "f"),
            "is_placeholder": settings.tax_set_aside_is_placeholder,
        },
        "main_job_pay": [main_job_pay_json(r) for r in reversed(pay_rows)],
    }


def main_job_pay_json(r: MainJobPayRow) -> dict:
    return {
        "id": r.id,
        "day": r.paid_on.isoformat(),
        "net_cents": r.net_cents,
        "gross_cents": r.gross_cents,
        "rrsp_cents": r.rrsp_cents,
        "match_cents": r.match_cents,
        "deductions_cents": r.deductions_cents,
        "notes": r.notes,
        "confirmed": r.confirmed,
    }


def vault_badge(
    side: SideWorkStore,
    income: IncomeStore,
    schedules: dict[str, PaySchedule],
    today: date,
    due_day: int,
) -> str | None:
    """'N overdue', else 'Statement due' (from due_day until last month is imported), else
    nothing. Counts only, never amounts."""
    overdue = sum(1 for w in open_weeks(side, schedules) if is_overdue(w.window, False, today))
    if overdue:
        return f"{overdue} overdue"
    if today.day < due_day or income.covers_month_before(today):
        return None
    return "Statement due"
