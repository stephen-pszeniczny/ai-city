"""Tests for migration 004: side-work entries, payments and exchange rates.

These check the rules the database itself enforces. Every database is temporary
and every value invented.
"""

import sqlite3

import pytest

from aicity.db import DbKind, open_database, schema_version

NOW = "2026-03-15T21:00:00Z"


@pytest.fixture
def conn(tmp_path):
    c = open_database(tmp_path / "sample.db", DbKind.SAMPLE)
    yield c
    c.close()


def add_entry(conn, **overrides):
    row = {
        "worked_on": "2026-03-10",
        "company": None,
        "role": None,
        "minutes": None,
        "rate_cents": None,
        "currency": "USD",
        "created_at": NOW,
        "updated_at": NOW,
    }
    row.update(overrides)
    cols = ", ".join(row)
    marks = ", ".join("?" for _ in row)
    return conn.execute(
        f"INSERT INTO side_work_entries ({cols}) VALUES ({marks})", tuple(row.values())
    ).lastrowid


def add_payment(conn, **overrides):
    row = {
        "kind": "pay",
        "company": None,
        "received_on": "2026-03-22",
        "amount_cents": 1000,
        "currency": "USD",
        "rate": None,
        "rate_date": None,
        "created_at": NOW,
    }
    row.update(overrides)
    cols = ", ".join(row)
    marks = ", ".join("?" for _ in row)
    return conn.execute(
        f"INSERT INTO side_work_payments ({cols}) VALUES ({marks})", tuple(row.values())
    ).lastrowid


def test_new_database_reaches_version_4(conn):
    assert schema_version(conn) == 4


def test_minimal_entry_is_accepted(conn):
    assert add_entry(conn) > 0


@pytest.mark.parametrize(
    "bad",
    [
        {"worked_on": "2026-02-30"},
        {"worked_on": "2026-3-1"},
        {"currency": "EUR"},
        {"minutes": 0},
        {"minutes": 10081},
        {"rate_cents": -1},
        {"company": ""},
        {"company": " padded "},
        {"role": "x" * 81},
        {"archived": 2},
    ],
)
def test_bad_entry_is_refused(conn, bad):
    with pytest.raises(sqlite3.IntegrityError):
        add_entry(conn, **bad)


@pytest.mark.parametrize(
    "bad",
    [
        {"kind": "other"},
        {"received_on": "2026-02-30"},
        {"amount_cents": -1},
        {"currency": "EUR"},
        {"rate": "1.37"},  # rate without its date
        {"rate": "0", "rate_date": "2026-03-20"},
        {"rate": "abc", "rate_date": "2026-03-20"},
    ],
)
def test_bad_payment_is_refused(conn, bad):
    with pytest.raises(sqlite3.IntegrityError):
        add_payment(conn, **bad)


def test_entry_must_point_at_a_real_payment(conn):
    with pytest.raises(sqlite3.IntegrityError):
        add_entry(conn, payment_id=999)


def test_entries_and_payments_are_never_deleted(conn):
    pid = add_payment(conn)
    eid = add_entry(conn, payment_id=pid)
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("DELETE FROM side_work_entries WHERE id = ?", (eid,))
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("DELETE FROM side_work_payments WHERE id = ?", (pid,))


def test_one_rate_per_currency_and_day(conn):
    sql = "INSERT INTO fx_rates (currency, day, rate, source, fetched_at) VALUES (?, ?, ?, ?, ?)"
    conn.execute(sql, ("USD", "2026-03-20", "1.3725", "boc", NOW))
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(sql, ("USD", "2026-03-20", "1.3800", "boc", NOW))


@pytest.mark.parametrize(
    "row",
    [
        ("CAD", "2026-03-20", "1.0", "boc", NOW),
        ("USD", "2026-02-30", "1.3", "boc", NOW),
        ("USD", "2026-03-20", "-1", "boc", NOW),
        ("USD", "2026-03-20", "1.3", "guess", NOW),
    ],
)
def test_bad_rate_is_refused(conn, row):
    sql = "INSERT INTO fx_rates (currency, day, rate, source, fetched_at) VALUES (?, ?, ?, ?, ?)"
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(sql, row)
