"""Tests for routine reminders (src/aicity/routine_reminder.py) and their place in the loop.

Local time is Europe/London (UTC in November). "Evening prep" runs Sunday to Thursday,
reminder 21:30. Every database is temporary and every value invented.
"""

from datetime import UTC, date, datetime, time
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from aicity import config
from aicity.db import DbKind, db_path, open_database
from aicity.notifications import SINCE_KEY
from aicity.reminder_loop import check_all_databases
from aicity.routine_reminder import check_routine_reminders, routine_title
from aicity.routines import RoutineStore
from aicity.settings import Routine

LOCAL = ZoneInfo("Europe/London")
PREP = Routine(
    "evening_prep", "Evening prep", (6, 0, 1, 2, 3), time(19), time(21, 30), ("Lunch", "Bag")
)
QUIET = Routine("quiet", "Quiet", (6,), time(19), None, ("Tea",))
ROUTINES = (PREP, QUIET)
SUNDAY = date(2026, 11, 29)


@pytest.fixture
def conn(tmp_path):
    c = open_database(tmp_path / "personal.db", DbKind.PERSONAL)
    yield c
    c.close()


def at(day: int, hh: int, mm: int = 0, month: int = 11) -> datetime:
    return datetime(2026, month, day, hh, mm, tzinfo=LOCAL)


def check(conn, now: datetime, routines=ROUTINES) -> int:
    return check_routine_reminders(conn, now, routines, now.astimezone(UTC))


def rows(conn) -> list[tuple]:
    return conn.execute(
        "SELECT routine_id, title, due_at, cleared_at IS NOT NULL FROM notifications "
        "WHERE kind = 'routine' ORDER BY id"
    ).fetchall()


def tick_all(conn, day: date = SUNDAY) -> None:
    store = RoutineStore(conn, clock=lambda: at(29, 21, 0))
    for item in PREP.items:
        store.set_tick(ROUTINES, "evening_prep", item, True, day, day)


def test_title():
    assert routine_title(PREP) == "Evening prep: not done yet"


def test_not_before_the_reminder_time(conn):
    assert check(conn, at(29, 21, 29)) == 0


def test_made_once_at_the_reminder_time(conn):
    assert check(conn, at(29, 21, 30)) == 1
    assert check(conn, at(29, 21, 45)) == 0
    assert rows(conn) == [("evening_prep", "Evening prep: not done yet", "2026-11-29T21:30", False)]


def test_nothing_when_everything_is_ticked(conn):
    tick_all(conn)
    assert check(conn, at(29, 21, 30)) == 0
    assert rows(conn) == []


def test_ticking_the_rest_after_it_fired_clears_it(conn):
    check(conn, at(29, 21, 30))
    tick_all(conn)
    check(conn, at(29, 21, 40))
    assert rows(conn)[0][3] == 1  # cleared


def test_next_day_clears_yesterdays_and_waits(conn):
    check(conn, at(29, 21, 30))
    assert check(conn, at(30, 0, 5)) == 0
    assert rows(conn) == [("evening_prep", "Evening prep: not done yet", "2026-11-29T21:30", True)]
    assert check(conn, at(30, 21, 30)) == 1


def test_no_reminder_without_remind_at(conn):
    check(conn, at(29, 23, 0))
    assert [r[0] for r in rows(conn)] == ["evening_prep"]


def test_not_on_a_day_the_routine_does_not_run(conn):
    assert check(conn, at(27, 22, 0)) == 0  # Friday


# --- In the reminder loop ----------------------------------------------------------------

ROUTINE_SETTINGS = """
[[routines]]
id = "evening_prep"
title = "Evening prep"
days = ["sun"]
shows_from = "19:00"
remind_at = "21:30"
items = ["Lunch"]
"""


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv(config.DATA_DIR_ENV, str(tmp_path))
    (tmp_path / "settings").mkdir()
    example = Path(__file__).resolve().parents[1] / "settings.example.toml"
    (tmp_path / "settings" / "settings.toml").write_text(example.read_text() + ROUTINE_SETTINGS)
    return tmp_path


def make_db(kind: DbKind) -> None:
    conn = open_database(db_path(kind), kind)
    try:
        conn.execute("INSERT INTO meta (key, value) VALUES (?, ?)", (SINCE_KEY, "2026-11-29T21:00"))
        conn.commit()
    finally:
        conn.close()


def kinds_in(kind: DbKind) -> list[str]:
    conn = open_database(db_path(kind), kind)
    try:
        return [r[0] for r in conn.execute("SELECT kind FROM notifications ORDER BY id")]
    finally:
        conn.close()


def test_loop_makes_routine_reminders_in_personal_only(data_dir):
    make_db(DbKind.PERSONAL)
    make_db(DbKind.SAMPLE)
    check_all_databases(lambda: datetime(2026, 11, 29, 21, 35, tzinfo=UTC), LOCAL)
    assert kinds_in(DbKind.PERSONAL).count("routine") == 1
    assert kinds_in(DbKind.SAMPLE) == []
