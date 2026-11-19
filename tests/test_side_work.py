"""Tests for SideWorkStore: logging side work and recording payments.

Every database is temporary and every value invented.
"""

from datetime import UTC, date, datetime
from decimal import Decimal

import pytest

from aicity.db import DbKind, open_database
from aicity.side_work import SideWorkConflict, SideWorkError, SideWorkNotFound, SideWorkStore

NOW = datetime(2026, 3, 25, 12, 0, tzinfo=UTC)


@pytest.fixture
def store(tmp_path):
    conn = open_database(tmp_path / "sample.db", DbKind.SAMPLE)
    yield SideWorkStore(conn, clock=lambda: NOW)
    conn.close()


def entry(store, **overrides):
    values = {
        "worked_on": date(2026, 3, 10),
        "company": "platform_a",
        "role": None,
        "hundredths": 200,
        "rate_cents": 4000,
        "currency": "USD",
    }
    values.update(overrides)
    return store.add_entry(**values)


def test_entry_with_only_a_date_round_trips(store):
    e = store.add_entry(
        worked_on=date(2026, 3, 10),
        company=None,
        role=None,
        hundredths=None,
        rate_cents=None,
        currency="CAD",
    )
    assert (e.worked_on, e.company, e.role, e.hundredths, e.rate_cents) == (
        date(2026, 3, 10),
        None,
        None,
        None,
        None,
    )
    assert store.entries() == [e]


def test_text_is_trimmed_and_blank_means_unknown(store):
    e = entry(store, company="  Some Co  ", role="   ")
    assert (e.company, e.role) == ("Some Co", None)


def test_too_long_text_is_refused(store):
    with pytest.raises(SideWorkError):
        entry(store, role="x" * 81)


def test_edit_changes_only_given_fields(store):
    e = entry(store)
    edited = store.edit_entry(e.id, hundredths=150)
    assert (edited.hundredths, edited.rate_cents) == (150, 4000)


def test_edit_can_clear_an_optional_field(store):
    e = entry(store)
    assert store.edit_entry(e.id, rate_cents=None).rate_cents is None


def test_missing_entry_is_not_found(store):
    with pytest.raises(SideWorkNotFound):
        store.edit_entry(999, hundredths=60)


def test_archived_entries_are_hidden_unless_asked(store):
    e = entry(store)
    store.archive_entry(e.id)
    assert store.entries() == []
    assert [x.id for x in store.entries(include_archived=True)] == [e.id]


def test_pay_links_every_given_entry(store):
    a, b = entry(store), entry(store, worked_on=date(2026, 3, 11))
    p = store.record_payment(
        kind="pay",
        company="platform_a",
        received_on=date(2026, 3, 22),
        amount_cents=16000,
        currency="USD",
        entry_ids=[a.id, b.id],
        rate=Decimal("1.3725"),
        rate_date=date(2026, 3, 20),
    )
    assert {x.payment_id for x in store.entries()} == {p.id}
    assert (p.rate, p.rate_date) == (Decimal("1.3725"), date(2026, 3, 20))
    assert store.payments() == [p]


def pay(store, entry_ids, **overrides):
    values = {
        "kind": "pay",
        "company": None,
        "received_on": date(2026, 3, 22),
        "amount_cents": 1000,
        "currency": "CAD",
        "entry_ids": entry_ids,
        "rate": None,
        "rate_date": None,
    }
    values.update(overrides)
    return store.record_payment(**values)


def test_an_entry_cannot_be_paid_twice(store):
    e = entry(store)
    pay(store, [e.id])
    with pytest.raises(SideWorkConflict):
        pay(store, [e.id])


def test_a_failed_payment_links_nothing(store):
    a, b = entry(store), entry(store)
    pay(store, [b.id])
    with pytest.raises(SideWorkConflict):
        pay(store, [a.id, b.id])
    assert store.entries()[0].payment_id is None
    assert len(store.payments()) == 1


def test_archived_entry_cannot_be_paid(store):
    e = entry(store)
    store.archive_entry(e.id)
    with pytest.raises(SideWorkConflict):
        pay(store, [e.id])


def test_paying_a_missing_entry_is_not_found(store):
    with pytest.raises(SideWorkNotFound):
        pay(store, [999])


def test_pay_needs_at_least_one_entry(store):
    with pytest.raises(SideWorkError):
        pay(store, [])


def test_bonus_links_no_entries(store):
    e = entry(store)
    with pytest.raises(SideWorkError):
        pay(store, [e.id], kind="bonus")
    bonus = pay(store, [], kind="bonus", company="platform_a")
    assert bonus.kind == "bonus"


def test_paid_entry_cannot_be_edited_or_archived(store):
    e = entry(store)
    pay(store, [e.id])
    with pytest.raises(SideWorkConflict):
        store.edit_entry(e.id, hundredths=50)
    with pytest.raises(SideWorkConflict):
        store.archive_entry(e.id)


def test_rate_can_be_filled_in_later(store):
    p = pay(store, [entry(store).id], currency="USD")
    filled = store.set_payment_rate(p.id, Decimal("1.37"), date(2026, 3, 20))
    assert filled.rate == Decimal("1.37")


def test_unknown_currency_is_refused(store):
    with pytest.raises(SideWorkError):
        entry(store, currency="EUR")


# --- Part B: bonus checkbox, notes, extras, deposit links ---------------------------


def test_payment_with_bonus_and_notes(store):
    e = entry(store, currency="CAD")
    p = pay(
        store, [e.id], amount_cents=9000, includes_bonus=True, bonus_cents=1000, notes="Holiday"
    )
    assert (p.includes_bonus, p.bonus_cents, p.notes) == (True, 1000, "Holiday")


def test_bonus_amount_needs_the_checkbox(store):
    e = entry(store)
    with pytest.raises(SideWorkError):
        pay(store, [e.id], bonus_cents=100)


@pytest.mark.parametrize("bad", [0, -5, 1001])
def test_bonus_amount_must_fit_the_payment(store, bad):
    e = entry(store)
    with pytest.raises(SideWorkError):
        pay(store, [e.id], amount_cents=1000, includes_bonus=True, bonus_cents=bad)


def test_long_notes_are_refused(store):
    with pytest.raises(SideWorkError):
        pay(store, [entry(store).id], notes="x" * 501)


def test_extra_income_needs_no_entries(store):
    x = pay(store, [], kind="extra", company="Some Co")
    assert x.kind == "extra"
    with pytest.raises(SideWorkError):
        pay(store, [entry(store).id], kind="extra")


def test_edit_payment_changes_notes_and_bonus_only(store):
    p = pay(store, [entry(store).id], amount_cents=5000)
    edited = store.edit_payment(p.id, notes="  Paid late  ", includes_bonus=True, bonus_cents=500)
    assert (edited.notes, edited.includes_bonus, edited.bonus_cents, edited.amount_cents) == (
        "Paid late",
        True,
        500,
        5000,
    )
    cleared = store.edit_payment(p.id, notes="", includes_bonus=False, bonus_cents=None)
    assert (cleared.notes, cleared.includes_bonus, cleared.bonus_cents) == (None, False, None)
