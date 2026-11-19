"""Tests for IncomeStore (deposits, main-job pay, statement imports) and for the
Side work view's bonus handling. Every database is temporary, every value invented."""

from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from aicity.db import DbKind, open_database
from aicity.income import IncomeError, IncomeStore, MainJobPayNotFound, MainJobPayTaken
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


def main_deposit(store, day=date(2026, 3, 19), cents=150900, ch="a"):
    return store.add_deposit(
        posted_on=day,
        amount_cents=cents,
        kind="main_job",
        source="main_job",
        row_key=key(ch),
        import_id=an_import(store),
    )


def typed(store, day=date(2026, 3, 20), net=150000, **stub):
    fields = {"gross_cents": None, "rrsp_cents": None, "match_cents": None, "notes": None}
    fields.update(stub)
    return store.add_main_job_pay(paid_on=day, net_cents=net, **fields)


def test_add_pay_with_stub_details(store):
    typed(store, net=210000, gross_cents=300000, rrsp_cents=15000, match_cents=7500, notes=" ok ")
    [row] = store.main_job_pay()
    assert (row.paid_on, row.net_cents, row.gross_cents, row.rrsp_cents, row.match_cents) == (
        date(2026, 3, 20),
        210000,
        300000,
        15000,
        7500,
    )
    assert row.deductions_cents == 75000  # 300000 - 210000 - 15000
    assert row.notes == "ok"


def test_add_typed_pay_is_unconfirmed(store):
    pay = typed(store)
    assert pay.confirmed is False
    assert pay.deposit_id is None
    assert [p.id for p in store.unconfirmed_main_job_pay()] == [pay.id]


def test_pay_added_from_a_deposit_is_confirmed(store):
    d = main_deposit(store)
    pay = typed(store, day=d.posted_on, net=d.amount_cents, deposit_id=d.id)
    assert pay.confirmed is True
    assert store.unconfirmed_main_job_pay() == []


def test_link_keeps_typed_date_and_takes_statement_amount(store):
    pay = typed(store)
    linked = store.link_main_job_pay(pay.id, main_deposit(store))
    assert (linked.paid_on, linked.net_cents, linked.confirmed) == (
        date(2026, 3, 20),
        150900,
        True,
    )
    assert len(store.main_job_pay()) == 1


def test_link_twice_is_refused(store):
    pay = typed(store)
    store.link_main_job_pay(pay.id, main_deposit(store, ch="a"))
    with pytest.raises(MainJobPayTaken):
        store.link_main_job_pay(pay.id, main_deposit(store, ch="b"))


def test_link_to_a_missing_pay_is_refused(store):
    with pytest.raises(MainJobPayTaken):
        store.link_main_job_pay(999, main_deposit(store))


def test_edit_typed_net_and_date_while_unconfirmed(store):
    pay = typed(store)
    row = store.edit_main_job_pay(
        pay.id,
        paid_on=date(2026, 3, 21),
        net_cents=151000,
        gross_cents=None,
        rrsp_cents=None,
        match_cents=None,
        notes=None,
    )
    assert (row.paid_on, row.net_cents) == (date(2026, 3, 21), 151000)


def test_edit_confirmed_amount_is_refused(store):
    pay = typed(store)
    store.link_main_job_pay(pay.id, main_deposit(store))
    for change in (
        {"net_cents": 150000, "paid_on": None},
        {"net_cents": None, "paid_on": date(2026, 3, 1)},
    ):
        with pytest.raises(IncomeError, match="confirmed by the statement"):
            store.edit_main_job_pay(
                pay.id, gross_cents=None, rrsp_cents=None, match_cents=None, notes=None, **change
            )


def test_edit_confirmed_stub_details_still_allowed(store):
    pay = typed(store)
    store.link_main_job_pay(pay.id, main_deposit(store))
    row = store.edit_main_job_pay(
        pay.id,
        paid_on=date(2026, 3, 20),  # unchanged: fine
        net_cents=150900,  # unchanged: fine
        gross_cents=281000,
        rrsp_cents=1000,
        match_cents=None,
        notes="stub",
    )
    assert (row.gross_cents, row.notes) == (281000, "stub")


def test_edit_unknown_pay_is_not_found(store):
    with pytest.raises(MainJobPayNotFound):
        store.edit_main_job_pay(
            1,
            paid_on=None,
            net_cents=None,
            gross_cents=None,
            rrsp_cents=None,
            match_cents=None,
            notes=None,
        )


@pytest.mark.parametrize(
    "fields",
    [
        {"net_cents": 0},
        {"gross_cents": 100000},  # below net
        {"gross_cents": 150000, "rrsp_cents": 1},  # below net + RRSP
        {"notes": "x" * 501},
    ],
)
def test_bad_typed_pay_is_refused(store, fields):
    with pytest.raises(IncomeError):
        typed(store, net=fields.pop("net_cents", 150000), **fields)
    assert store.main_job_pay() == []


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
