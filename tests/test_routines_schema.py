"""Tests for migration 012: routine ticks and routine reminders.

These check the rules the database itself enforces. Every database here is temporary.
"""

import sqlite3

import pytest

from aicity.db import DbKind, open_database

STAMP = "2026-11-29T20:00:00Z"


@pytest.fixture
def conn(tmp_path):
    c = open_database(tmp_path / "sample.db", DbKind.SAMPLE)
    yield c
    c.close()


def tick(conn, **overrides) -> None:
    row = {
        "day": "2026-11-29",
        "routine_id": "evening_prep",
        "item": "Lunch packed",
        "ticked_at": STAMP,
    }
    row.update(overrides)
    conn.execute(
        "INSERT INTO routine_ticks (day, routine_id, item, ticked_at) VALUES (?, ?, ?, ?)",
        tuple(row.values()),
    )


def notify(
    conn, kind="routine", routine_id="evening_prep", due_at="2026-11-29T21:30", task_id=None
):
    conn.execute(
        "INSERT INTO notifications (kind, task_id, routine_id, title, due_at, created_at) "
        "VALUES (?, ?, ?, 'x', ?, ?)",
        (kind, task_id, routine_id, due_at, STAMP),
    )


# --- Ticks -----------------------------------------------------------------------------


def test_a_good_tick(conn):
    tick(conn)
    assert conn.execute("SELECT count(*) FROM routine_ticks").fetchone() == (1,)


def test_a_tick_is_stored_once(conn):
    tick(conn)
    with pytest.raises(sqlite3.IntegrityError):
        tick(conn)


@pytest.mark.parametrize(
    "overrides",
    [
        {"day": "2026-02-30"},
        {"day": "soon"},
        {"item": ""},
        {"item": " Lunch"},
        {"item": "x" * 101},
        {"routine_id": "Evening"},
        {"routine_id": ""},
        {"routine_id": "x" * 32},
        {"ticked_at": "yesterday"},
    ],
)
def test_bad_ticks_are_refused(conn, overrides):
    with pytest.raises(sqlite3.IntegrityError):
        tick(conn, **overrides)


def test_unticking_deletes_the_row(conn):
    tick(conn)
    conn.execute("DELETE FROM routine_ticks")
    assert conn.execute("SELECT count(*) FROM routine_ticks").fetchone() == (0,)


# --- Routine reminders ------------------------------------------------------------------


def test_a_routine_reminder_needs_its_routine(conn):
    with pytest.raises(sqlite3.IntegrityError):
        notify(conn, routine_id=None)


def test_other_kinds_never_have_a_routine(conn):
    with pytest.raises(sqlite3.IntegrityError):
        notify(conn, kind="checkin", routine_id="evening_prep")


def test_one_routine_reminder_per_routine_per_day(conn):
    notify(conn)
    with pytest.raises(sqlite3.IntegrityError):
        notify(conn, due_at="2026-11-29T22:00")
    notify(conn, routine_id="morning")
    notify(conn, due_at="2026-11-30T21:30")


def test_existing_kinds_still_work(conn):
    notify(conn, kind="checkin", routine_id=None, due_at="2026-11-29T16:00")
    notify(conn, kind="statement", routine_id=None, due_at="2026-12-08T09:00")
    assert conn.execute("SELECT count(*) FROM notifications").fetchone() == (2,)
