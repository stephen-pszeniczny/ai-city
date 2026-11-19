"""Tests for IncomeStore (deposits, main-job pay, statement imports) and for the
Side work view's bonus handling. Every database is temporary, every value invented."""

from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from aicity.db import DbKind, open_database
from aicity.income import IncomeError, IncomeStore
from aicity.settings import IncomeSettings
from aicity.side_work import SideWorkStore, side_work_view

NOW = datetime(2026, 3, 25, 12, 0, tzinfo=UTC)
INCOME = IncomeSettings(tax_set_aside_percent=Decimal(20), tax_set_aside_is_placeholder=True)


@pytest.fixture
def conn(tmp_path):
    c = open_database(tmp_path / "sample.db", DbKind.SAMPLE)
    yield c
    c.close()


@pytest.fixture
def store(conn):
    return IncomeStore(conn, clock=lambda: NOW)


def key(ch: str) -> str:
    return ch * 64


def an_import(store):
    return store.record_import(
        first_day=date(2026, 3, 1),
        last_day=date(2026, 3, 31),
        kept=1,
        duplicates=0,
        skipped=0,
        spending=4,
    )


def test_deposit_and_main_job_pay(store):
    imp = an_import(store)
    d = store.add_deposit(
        posted_on=date(2026, 3, 20),
        amount_cents=210000,
        kind="main_job",
        source="main_job",
        row_key=key("a"),
        import_id=imp,
    )
    store.set_main_job_pay(
        d.id, gross_cents=300000, rrsp_cents=15000, match_cents=7500, notes=" ok "
    )
    [row] = store.main_job_pay()
    assert (row.posted_on, row.net_cents, row.gross_cents, row.rrsp_cents, row.match_cents) == (
        date(2026, 3, 20),
        210000,
        300000,
        15000,
        7500,
    )
    assert row.deductions_cents == 75000  # 300000 - 210000 - 15000
    assert row.notes == "ok"


def test_main_job_deposit_without_stub_details_is_listed(store):
    imp = an_import(store)
    store.add_deposit(
        posted_on=date(2026, 3, 6),
        amount_cents=200000,
        kind="main_job",
        source="main_job",
        row_key=key("b"),
        import_id=imp,
    )
    [row] = store.main_job_pay()
    assert (row.gross_cents, row.deductions_cents) == (None, None)


def test_stub_details_can_be_changed_later(store):
    imp = an_import(store)
    d = store.add_deposit(
        posted_on=date(2026, 3, 6),
        amount_cents=200000,
        kind="main_job",
        source="main_job",
        row_key=key("c"),
        import_id=imp,
    )
    store.set_main_job_pay(d.id, gross_cents=280000, rrsp_cents=None, match_cents=None, notes=None)
    store.set_main_job_pay(d.id, gross_cents=281000, rrsp_cents=1000, match_cents=None, notes=None)
    assert store.main_job_pay()[0].gross_cents == 281000


def test_stub_details_only_for_main_job_deposits(store):
    imp = an_import(store)
    d = store.add_deposit(
        posted_on=date(2026, 3, 6),
        amount_cents=5000,
        kind="side_work",
        source="platform_a",
        row_key=key("d"),
        import_id=imp,
    )
    with pytest.raises(IncomeError):
        store.set_main_job_pay(d.id, gross_cents=1, rrsp_cents=None, match_cents=None, notes=None)


def test_gross_below_net_is_refused(store):
    imp = an_import(store)
    d = store.add_deposit(
        posted_on=date(2026, 3, 6),
        amount_cents=200000,
        kind="main_job",
        source="main_job",
        row_key=key("e"),
        import_id=imp,
    )
    with pytest.raises(IncomeError):
        store.set_main_job_pay(
            d.id, gross_cents=100000, rrsp_cents=None, match_cents=None, notes=None
        )


def test_existing_row_keys(store):
    imp = an_import(store)
    store.add_deposit(
        posted_on=date(2026, 3, 6),
        amount_cents=1,
        kind="main_job",
        source="main_job",
        row_key=key("f"),
        import_id=imp,
    )
    assert store.existing_row_keys({key("f"), key("g")}) == {key("f")}


def test_imports_are_listed_newest_first(store):
    first, second = an_import(store), an_import(store)
    assert [i.id for i in store.imports()] == [second, first]


# --- The Side work view with the bonus box ---------------------------------------------


def paid_week(conn, received_cents, **bonus):
    side = SideWorkStore(conn, clock=lambda: NOW)
    e = side.add_entry(
        worked_on=date(2026, 3, 10),
        company="Some Co",
        role=None,
        hundredths=350,
        rate_cents=4000,
        currency="CAD",
    )  # 3.5 h x 40.00 = 140.00
    side.record_payment(
        kind="pay",
        company="Some Co",
        received_on=date(2026, 3, 20),
        amount_cents=received_cents,
        currency="CAD",
        entry_ids=[e.id],
        rate=None,
        rate_date=None,
        **bonus,
    )
    [g] = side_work_view(side, conn, {}, INCOME, date(2026, 3, 25))["groups"]
    return g


def test_view_bonus_box_with_no_amount(conn):
    g = paid_week(conn, 15000, includes_bonus=True)
    assert (g["difference_cad_cents"], g["bonus_cad_cents"]) == (0, 1000)


def test_view_bonus_box_with_amount(conn):
    g = paid_week(conn, 15000, includes_bonus=True, bonus_cents=500)
    assert (g["difference_cad_cents"], g["bonus_cad_cents"]) == (500, 500)


def test_view_lists_extra_income_and_counts_it(conn):
    side = SideWorkStore(conn, clock=lambda: NOW)
    side.record_payment(
        kind="extra",
        company="Some Co",
        received_on=date(2026, 3, 20),
        amount_cents=5000,
        currency="CAD",
        entry_ids=[],
        rate=None,
        rate_date=None,
        notes="One-off",
    )
    v = side_work_view(side, conn, {}, INCOME, date(2026, 3, 25))
    assert [x["notes"] for x in v["extras"]] == ["One-off"]
    assert v["summary"]["month_received_cad_cents"] == 5000
