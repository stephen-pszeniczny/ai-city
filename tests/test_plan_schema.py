"""Tests for migration 010: the plan_weeks and plan_blocks tables.

These check the rules the database itself enforces, so bad data is refused even if
a bug in the app tries to write it. Every database here is temporary.
"""

import sqlite3

import pytest

from aicity.db import DbKind, open_database

NOW = "2026-11-25T15:00:00Z"
MONDAY = "2026-11-23"


@pytest.fixture
def conn(tmp_path):
    c = open_database(tmp_path / "sample.db", DbKind.SAMPLE)
    yield c
    c.close()


def add_week(conn, week_start=MONDAY, **overrides) -> int:
    row = {"week_start": week_start, "created_at": NOW, "checked_in_at": None, "grocery_day": None}
    row.update(overrides)
    cols = ", ".join(row)
    marks = ", ".join("?" for _ in row)
    return conn.execute(
        f"INSERT INTO plan_weeks ({cols}) VALUES ({marks})", tuple(row.values())
    ).lastrowid


def add_block(conn, week_id, **overrides) -> int:
    row = {
        "week_id": week_id,
        "day": "2026-11-25",
        "start_time": "09:00",
        "end_time": "12:00",
        "title": "Work",
        "kind": "work",
        "source": "settings",
        "settings_key": "work|Work",
        "status": "planned",
        "edited": 0,
        "created_at": NOW,
        "updated_at": NOW,
    }
    row.update(overrides)
    cols = ", ".join(row)
    marks = ", ".join("?" for _ in row)
    return conn.execute(
        f"INSERT INTO plan_blocks ({cols}) VALUES ({marks})", tuple(row.values())
    ).lastrowid


# --- Weeks -------------------------------------------------------------------


def test_a_week_starts_on_monday(conn):
    with pytest.raises(sqlite3.IntegrityError):
        add_week(conn, "2026-11-24")
    assert add_week(conn, MONDAY)


def test_a_week_is_saved_once(conn):
    add_week(conn)
    with pytest.raises(sqlite3.IntegrityError):
        add_week(conn)


@pytest.mark.parametrize("bad", ["2026-11-30", "2026-11-22", "2026-02-30", "soon"])
def test_grocery_day_inside_the_week(conn, bad):
    with pytest.raises(sqlite3.IntegrityError):
        add_week(conn, grocery_day=bad)


def test_grocery_day_on_sunday_is_fine(conn):
    assert add_week(conn, grocery_day="2026-11-29")


# --- Blocks ------------------------------------------------------------------


def test_good_blocks_are_accepted(conn):
    week = add_week(conn)
    add_block(conn, week)
    add_block(conn, week, kind="gym", title="Gym", settings_key="gym|Gym", status="done")
    add_block(
        conn,
        week,
        kind="event",
        title="Hockey",
        source="added",
        settings_key=None,
        day="2026-11-29",
        start_time="21:00",
        end_time="22:00",
    )
    add_block(conn, week, status="replaced")
    assert conn.execute("SELECT count(*) FROM plan_blocks").fetchone()[0] == 4


@pytest.mark.parametrize(
    "overrides",
    [
        {"end_time": "09:00"},
        {"end_time": "08:00"},
        {"start_time": "7:30"},
        {"end_time": "24:00"},
        {"title": ""},
        {"title": " Work"},
        {"title": "x" * 101},
        {"kind": "nap"},
        {"status": "done"},
        {"status": "skipped"},
        {"status": "gone"},
        {"settings_key": None},
        {"source": "added"},
        {"source": "added", "settings_key": None, "edited": 1},
        {"source": "typed"},
        {"edited": 2},
        {"day": "2026-11-30"},
        {"day": "2026-11-22"},
        {"day": "2026-02-30"},
        {"updated_at": "2026-11-25T14:00:00Z"},
    ],
)
def test_bad_blocks_are_refused(conn, overrides):
    week = add_week(conn)
    with pytest.raises(sqlite3.IntegrityError):
        add_block(conn, week, **overrides)


def test_moving_a_block_out_of_its_week_is_refused(conn):
    week = add_week(conn)
    block = add_block(conn, week)
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("UPDATE plan_blocks SET day = '2026-12-01' WHERE id = ?", (block,))


def test_blocks_and_weeks_are_never_deleted(conn):
    week = add_week(conn)
    block = add_block(conn, week)
    with pytest.raises(sqlite3.IntegrityError, match="never deleted"):
        conn.execute("DELETE FROM plan_blocks WHERE id = ?", (block,))
    with pytest.raises(sqlite3.IntegrityError, match="never deleted"):
        conn.execute("DELETE FROM plan_weeks WHERE id = ?", (week,))
