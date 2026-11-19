"""Tests for the Income screen (income_view) and the Vault badge (vault_badge).

Every database is temporary and every value invented. "Today" is 2026-03-25.
"""

from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from aicity.db import DbKind, open_database
from aicity.income import IncomeStore
from aicity.income_view import income_view, vault_badge
from aicity.settings import IncomeSettings, PaySchedule
from aicity.side_work import SideWorkStore

NOW = datetime(2026, 3, 25, 12, 0, tzinfo=UTC)
TODAY = date(2026, 3, 25)
INCOME = IncomeSettings(tax_set_aside_percent=Decimal(20), tax_set_aside_is_placeholder=True)
SCHED = {"platform_a": PaySchedule("platform_a", "Platform A", 5, (5, 6), (3, 4))}
GOAL = 750000


@pytest.fixture
def conn(tmp_path):
    c = open_database(tmp_path / "sample.db", DbKind.SAMPLE)
    yield c
    c.close()


@pytest.fixture
def stores(conn):
    return SideWorkStore(conn, clock=lambda: NOW), IncomeStore(conn, clock=lambda: NOW)


def main_pay(income, day, net, gross=None, rrsp=None, match=None):
    return income.add_main_job_pay(
        paid_on=day,
        net_cents=net,
        gross_cents=gross,
        rrsp_cents=rrsp,
        match_cents=match,
        notes=None,
    )


def deposit(income, day, cents, ch="a"):
    imp = income.record_import(
        first_day=day, last_day=day, kept=1, duplicates=0, skipped=0, spending=0
    )
    return income.add_deposit(
        posted_on=day,
        amount_cents=cents,
        kind="main_job",
        source="main_job",
        row_key=ch * 64,
        import_id=imp,
    )


def side_pay(side, day, cents, hundredths=None, company="platform_a"):
    ids = []
    if hundredths:
        ids = [
            side.add_entry(
                worked_on=day,
                company=company,
                role=None,
                hundredths=hundredths,
                rate_cents=4000,
                currency="CAD",
            ).id
        ]
    return side.record_payment(
        kind="pay" if ids else "extra",
        company=company,
        received_on=day,
        amount_cents=cents,
        currency="CAD",
        entry_ids=ids,
        rate=None,
        rate_date=None,
    )


def view(conn, stores, goal_split=None):
    side, income = stores
    return income_view(
        conn, side, income, GOAL, INCOME, SCHED, "Day job", TODAY, goal_split=goal_split
    )


def test_month_gross_net_and_match(conn, stores):
    side, income = stores
    main_pay(income, date(2026, 3, 6), 210000, gross=300000, rrsp=15000, match=7500)
    side_pay(side, date(2026, 3, 22), 20000, hundredths=500)
    m = view(conn, stores)["month"]
    assert m["gross_cents"] == 300000 + 20000
    assert m["net_cents"] == 210000 + 20000 - 4000  # side income less its 20% set-aside
    assert m["employer_match_cents"] == 7500  # shown apart, never in the totals
    assert m["goal_cents"] == GOAL and m["gross_missing"] is False
    assert {s["key"]: s["cents"] for s in m["by_source"]} == {
        "main_job": 300000,
        "platform_a": 20000,
    }


def test_missing_gross_uses_net_and_says_so(conn, stores):
    _side, income = stores
    main_pay(income, date(2026, 3, 6), 210000)
    m = view(conn, stores)["month"]
    assert (m["gross_cents"], m["gross_missing"]) == (210000, True)


def test_main_job_pay_list_has_deductions(conn, stores):
    _side, income = stores
    main_pay(income, date(2026, 3, 6), 210000, gross=300000, rrsp=15000, match=7500)
    [row] = view(conn, stores)["main_job_pay"]
    assert (row["net_cents"], row["deductions_cents"], row["match_cents"]) == (210000, 75000, 7500)


def test_view_typed_pay_counts_and_is_unconfirmed(conn, stores):
    _side, income = stores
    pay = main_pay(income, date(2026, 3, 20), 210000, gross=300000)
    v = view(conn, stores)
    assert v["month"]["gross_cents"] == 300000  # counts toward the goal at once
    assert v["main_job_pay"] == [
        {
            "id": pay.id,
            "day": "2026-03-20",
            "net_cents": 210000,
            "gross_cents": 300000,
            "rrsp_cents": None,
            "match_cents": None,
            "deductions_cents": 90000,
            "notes": None,
            "confirmed": False,
            "checked_by_hand": False,
        }
    ]


def test_view_counts_linked_pay_in_the_typed_month(conn, stores):
    _side, income = stores
    pay = main_pay(income, date(2026, 3, 1), 210000)
    income.link_main_job_pay(pay.id, deposit(income, date(2026, 2, 28), 210000))
    v = view(conn, stores)
    assert v["month"]["gross_cents"] == 210000
    feb = next(m for m in v["months"] if m["month"] == "2026-02")
    assert feb["total_cents"] == 0
    assert v["main_job_pay"][0]["confirmed"] is True
    assert v["main_job_pay"][0]["day"] == "2026-03-01"


def test_six_months_oldest_first_with_empty_months(conn, stores):
    side, _income = stores
    side_pay(side, date(2026, 1, 15), 5000, hundredths=100)
    months = view(conn, stores)["months"]
    assert [m["month"] for m in months] == [
        "2025-10",
        "2025-11",
        "2025-12",
        "2026-01",
        "2026-02",
        "2026-03",
    ]
    assert [m["total_cents"] for m in months] == [0, 0, 0, 5000, 0, 0]


def test_extra_income_is_its_own_source(conn, stores):
    side, _income = stores
    side_pay(side, date(2026, 3, 10), 3000, company="Some Co")
    m = view(conn, stores)["month"]
    assert {s["key"] for s in m["by_source"]} == {"extra"}


def test_platform_hours_and_effective_rate(conn, stores):
    side, _income = stores
    side_pay(side, date(2026, 3, 22), 19215, hundredths=350)
    [p] = view(conn, stores)["platforms"]
    assert (p["id"], p["hours"], p["received_cad_cents"], p["rate_cad_cents"]) == (
        "platform_a",
        "3.5",
        19215,
        5490,
    )


# --- Badge ---------------------------------------------------------------------------------


def badge(conn, stores, today):
    side, income = stores
    return vault_badge(side, income, SCHED, today, 8)


def test_badge_statement_due_from_the_due_day(conn, stores):
    _side, income = stores
    assert badge(conn, stores, date(2026, 3, 7)) is None
    assert badge(conn, stores, date(2026, 3, 8)) == "Statement due"
    income.record_import(
        first_day=date(2026, 2, 28),
        last_day=date(2026, 2, 28),
        kept=0,
        duplicates=0,
        skipped=0,
        spending=0,
    )
    assert badge(conn, stores, date(2026, 3, 8)) is None


def test_covers_month_before_handles_january(stores):
    _side, income = stores
    income.record_import(
        first_day=date(2027, 1, 1),
        last_day=date(2027, 1, 5),
        kept=0,
        duplicates=0,
        skipped=0,
        spending=0,
    )
    assert income.covers_month_before(date(2027, 1, 9)) is False
    income.record_import(
        first_day=date(2026, 12, 31),
        last_day=date(2026, 12, 31),
        kept=0,
        duplicates=0,
        skipped=0,
        spending=0,
    )
    assert income.covers_month_before(date(2027, 1, 9)) is True


def test_badge_clears_once_last_month_is_imported(conn, stores):
    _side, income = stores
    income.record_import(
        first_day=date(2026, 2, 1),
        last_day=date(2026, 2, 28),
        kept=0,
        duplicates=0,
        skipped=0,
        spending=0,
    )
    assert badge(conn, stores, date(2026, 3, 10)) is None


def test_badge_overdue_wins_and_has_no_amounts(conn, stores):
    side, _income = stores
    side.add_entry(
        worked_on=date(2026, 2, 2),
        company="platform_a",
        role=None,
        hundredths=100,
        rate_cents=4000,
        currency="CAD",
    )
    text = badge(conn, stores, date(2026, 3, 10))
    assert text == "1 overdue"
    assert "$" not in text and "." not in text


# --- Goal split -----------------------------------------------------------------------------


def test_view_goal_split_amounts(conn, stores):
    side, income = stores
    main_pay(income, date(2026, 3, 6), 210000, gross=300000)
    side_pay(side, date(2026, 3, 22), 100000, hundredths=500)
    side_pay(side, date(2026, 3, 23), 40000, company="Some Co")
    m = view(conn, stores, goal_split=(250000, 100000))["month"]
    # Not capped at the goals: the screen shows the real amounts and percent.
    assert (m["main_job_gross_cents"], m["side_gross_cents"]) == (300000, 140000)
    assert m["goal_split"] == {"main_job_cents": 250000, "side_income_cents": 100000}


def test_view_main_job_uses_net_when_gross_missing(conn, stores):
    _side, income = stores
    main_pay(income, date(2026, 3, 6), 210000)
    m = view(conn, stores, goal_split=(250000, 100000))["month"]
    assert (m["main_job_gross_cents"], m["side_gross_cents"]) == (210000, 0)


def test_view_has_no_split_without_goals(conn, stores):
    assert view(conn, stores)["month"]["goal_split"] is None


def test_view_shows_hand_checked_pay_as_confirmed(conn, stores):
    _side, income = stores
    pay = main_pay(income, date(2026, 3, 6), 210000)
    conn.execute(
        "UPDATE main_job_payments SET hand_checked_at = '2026-03-25T12:00:00Z' WHERE id = ?",
        (pay.id,),
    )
    [row] = view(conn, stores)["main_job_pay"]
    assert (row["confirmed"], row["checked_by_hand"]) == (True, True)


# --- Year to date ---------------------------------------------------------------------------


def test_view_year_counts_only_this_calendar_year(conn, stores):
    side, income = stores
    main_pay(income, date(2025, 12, 19), 210000, gross=300000)  # last year: left out
    main_pay(income, date(2026, 1, 9), 210000, gross=300000)
    main_pay(income, date(2026, 2, 6), 205000)  # no gross yet: its net counts
    side_pay(side, date(2026, 2, 20), 50000, hundredths=500)
    side_pay(side, date(2025, 12, 30), 40000, hundredths=400)  # last year: left out
    y = view(conn, stores)["year"]
    assert y == {
        "year": 2026,
        "main_job_gross_cents": 505000,
        "side_gross_cents": 50000,
        "gross_cents": 555000,
        "net_cents": 210000 + 205000 + 50000 - 10000,  # side income less its 20% set-aside
    }
