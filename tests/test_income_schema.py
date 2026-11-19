"""Tests for migration 005: deposits, main-job pay, statement imports, and the new
payment columns (deposit link, bonus, notes, extra). All values are invented."""

import sqlite3

import pytest

from aicity.db import DbKind, load_migrations, migrate, open_database, schema_version

NOW = "2026-03-15T21:00:00Z"


@pytest.fixture
def conn(tmp_path):
    c = open_database(tmp_path / "sample.db", DbKind.SAMPLE)
    yield c
    c.close()


def add_import(conn):
    return conn.execute(
        "INSERT INTO statement_imports (first_day, last_day, kept, duplicates, skipped, spending,"
        " created_at) VALUES ('2026-03-01', '2026-03-31', 1, 0, 0, 5, ?)",
        (NOW,),
    ).lastrowid


def add_deposit(conn, **overrides):
    row = {
        "posted_on": "2026-03-20",
        "amount_cents": 150000,
        "kind": "main_job",
        "source": "main_job",
        "row_key": "a" * 64,
        "import_id": add_import(conn),
        "created_at": NOW,
    }
    row.update(overrides)
    cols, marks = ", ".join(row), ", ".join("?" for _ in row)
    return conn.execute(
        f"INSERT INTO deposits ({cols}) VALUES ({marks})", tuple(row.values())
    ).lastrowid


def add_payment(conn, **overrides):
    row = {
        "kind": "bonus",
        "received_on": "2026-03-22",
        "amount_cents": 1000,
        "currency": "CAD",
        "created_at": NOW,
    }
    row.update(overrides)
    cols, marks = ", ".join(row), ", ".join("?" for _ in row)
    return conn.execute(
        f"INSERT INTO side_work_payments ({cols}) VALUES ({marks})", tuple(row.values())
    ).lastrowid


def test_new_database_reaches_version_5(conn):
    assert schema_version(conn) == 5


def test_part_a_rows_survive_the_upgrade(tmp_path):
    migrations = load_migrations()
    c = open_database(tmp_path / "sample.db", DbKind.SAMPLE, migrations[:4])
    pid = c.execute(
        "INSERT INTO side_work_payments (kind, received_on, amount_cents, currency, rate,"
        " rate_date, created_at) VALUES ('pay', '2026-03-22', 13950, 'USD', '1.3725',"
        " '2026-03-20', ?)",
        (NOW,),
    ).lastrowid
    c.close()
    c = open_database(tmp_path / "sample.db", DbKind.SAMPLE, migrations)
    row = c.execute(
        "SELECT kind, amount_cents, rate, includes_bonus, bonus_cents, notes, deposit_id, is_extra"
        " FROM side_work_payments WHERE id = ?",
        (pid,),
    ).fetchone()
    assert row == ("pay", 13950, "1.3725", 0, None, None, None, 0)
    with pytest.raises(sqlite3.IntegrityError):
        c.execute("DELETE FROM side_work_payments WHERE id = ?", (pid,))
    c.close()


@pytest.mark.parametrize(
    "bad",
    [
        {"bonus_cents": 500},  # a bonus amount without the checkbox
        {"includes_bonus": 1, "bonus_cents": 1001},  # more than the payment
        {"includes_bonus": 1, "bonus_cents": 0},
        {"includes_bonus": 2},
        {"notes": "x" * 501},
        {"kind": "pay", "is_extra": 1},  # only bonus-kind rows can be extras
    ],
)
def test_bad_payment_extras_are_refused(conn, bad):
    with pytest.raises(sqlite3.IntegrityError):
        add_payment(conn, **bad)


def test_a_deposit_proves_one_payment_at_most(conn):
    d = add_deposit(conn)
    add_payment(conn, deposit_id=d)
    with pytest.raises(sqlite3.IntegrityError):
        add_payment(conn, deposit_id=d)


def test_a_payment_must_point_at_a_real_deposit(conn):
    with pytest.raises(sqlite3.IntegrityError):
        add_payment(conn, deposit_id=999)


@pytest.mark.parametrize(
    "bad",
    [
        {"amount_cents": 0},
        {"kind": "spending"},
        {"posted_on": "2026-02-30"},
    ],
)
def test_bad_deposit_is_refused(conn, bad):
    with pytest.raises(sqlite3.IntegrityError):
        add_deposit(conn, **bad)


def test_the_same_statement_row_is_stored_once(conn):
    add_deposit(conn, row_key="s" * 64)
    with pytest.raises(sqlite3.IntegrityError):
        add_deposit(conn, row_key="s" * 64)


def test_main_job_pay_checks(conn):
    d = add_deposit(conn)
    sql = (
        "INSERT INTO main_job_pay (deposit_id, gross_cents, rrsp_cents, match_cents, notes)"
        " VALUES (?, ?, ?, ?, ?)"
    )
    conn.execute(sql, (d, 300000, 15000, 7500, None))
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(sql, (d, 1, 1, 1, None))  # one row per deposit
    d2 = add_deposit(conn, row_key="b" * 64)
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(sql, (d2, -1, None, None, None))


@pytest.mark.parametrize("table", ["deposits", "main_job_pay", "statement_imports"])
def test_nothing_new_is_ever_deleted(conn, table):
    d = add_deposit(conn)
    conn.execute("INSERT INTO main_job_pay (deposit_id, gross_cents) VALUES (?, 1)", (d,))
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(f"DELETE FROM {table}")


def test_migrate_is_a_no_op_when_current(conn):
    assert migrate(conn, load_migrations()) == 0
