"""Tests for the weekly Sunday check-in reminder (src/aicity/checkin_reminder.py),
migration 011, and its place in the reminder loop.

Every database is temporary and every value invented. Times are local wall-clock
(Europe/London, which is UTC in November). Check-in opens 12:00, reminder 16:00.
"""

import sqlite3
from datetime import UTC, date, datetime, time
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from aicity import config
from aicity.checkin_reminder import CHECKIN_TITLE, check_checkin_reminder
from aicity.db import DbKind, db_path, open_database
from aicity.notifications import SINCE_KEY
from aicity.plan import PlanStore
from aicity.reminder_loop import check_all_databases
from aicity.settings import BlockRule, PlanSettings

LOCAL = ZoneInfo("Europe/London")
RULES = PlanSettings(blocks=(BlockRule("Work", "work", (0, 1, 2, 3, 4), time(9), time(17)),))
THIS_MONDAY = date(2026, 11, 23)
NEXT_MONDAY = date(2026, 11, 30)


@pytest.fixture
def conn(tmp_path):
    c = open_database(tmp_path / "personal.db", DbKind.PERSONAL)
    yield c
    c.close()


def at(day: int, hh: int, mm: int = 0) -> datetime:
    return datetime(2026, 11, day, hh, mm, tzinfo=LOCAL)


def check(conn, now: datetime, rules: PlanSettings = RULES) -> int:
    return check_checkin_reminder(conn, now, rules, now.astimezone(UTC))


def rows(conn) -> list[tuple]:
    return conn.execute(
        "SELECT kind, task_id, title, due_at, dismissed_at IS NOT NULL, cleared_at IS NOT NULL "
        "FROM notifications ORDER BY id"
    ).fetchall()


# --- Making it once ------------------------------------------------------------------


def test_not_before_the_reminder_time(conn):
    assert check(conn, at(29, 15, 59)) == 0
    assert rows(conn) == []


def test_made_once_at_the_reminder_time(conn):
    assert check(conn, at(29, 16, 0)) == 1
    assert check(conn, at(29, 16, 30)) == 0
    assert rows(conn) == [("checkin", None, CHECKIN_TITLE, "2026-11-29T16:00", False, False)]


def test_mac_asleep_all_sunday_gets_it_on_monday(conn):
    # Sunday the 22nd passed with no check; Monday the 23rd, this week isn't planned.
    assert check(conn, at(23, 8, 0)) == 1
    assert check(conn, at(23, 8, 30)) == 0
    assert rows(conn) == [("checkin", None, CHECKIN_TITLE, "2026-11-22T16:00", False, False)]


def test_cleared_once_the_week_is_checked_in(conn):
    check(conn, at(29, 16, 0))
    store = PlanStore(conn, clock=lambda: at(29, 17, 0))
    store.ensure_week(NEXT_MONDAY, RULES, date(2026, 11, 29))
    store.finish_checkin(NEXT_MONDAY)
    assert check(conn, at(29, 17, 0)) == 0
    assert rows(conn) == [("checkin", None, CHECKIN_TITLE, "2026-11-29T16:00", False, True)]
    assert check(conn, at(29, 18, 0)) == 0


def test_a_dismissed_reminder_is_not_made_again(conn):
    check(conn, at(29, 16, 0))
    conn.execute("UPDATE notifications SET dismissed_at = '2026-11-29T16:05:00Z'")
    assert check(conn, at(29, 18, 0)) == 0
    assert len(rows(conn)) == 1


def test_uses_the_settings_reminder_time(conn):
    rules = PlanSettings(blocks=(), checkin_reminder=time(18, 30))
    assert check(conn, at(29, 18, 0), rules) == 0
    assert check(conn, at(29, 18, 30), rules) == 1


# --- Migration 011 ---------------------------------------------------------------------


def test_checkin_kind_never_has_a_task(conn):
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            "INSERT INTO notifications (kind, task_id, title, due_at, created_at) "
            "VALUES ('checkin', 1, 'x', '2026-11-29T16:00', '2026-11-29T16:00:00Z')"
        )


def test_one_checkin_reminder_per_moment(conn):
    insert = (
        "INSERT INTO notifications (kind, task_id, title, due_at, created_at) "
        "VALUES ('checkin', NULL, 'x', '2026-11-29T16:00', '2026-11-29T16:00:00Z')"
    )
    conn.execute(insert)
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(insert)


# --- In the reminder loop ----------------------------------------------------------------

PLAN_SETTINGS = """
[plan]

[[plan.blocks]]
title = "Work"
kind = "work"
days = ["mon"]
start = "09:00"
end = "17:00"
"""


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv(config.DATA_DIR_ENV, str(tmp_path))
    (tmp_path / "settings").mkdir()
    example = Path(__file__).resolve().parents[1] / "settings.example.toml"
    (tmp_path / "settings" / "settings.toml").write_text(example.read_text() + PLAN_SETTINGS)
    return tmp_path


def make_db(kind: DbKind) -> None:
    conn = open_database(db_path(kind), kind)
    try:
        conn.execute("INSERT INTO meta (key, value) VALUES (?, ?)", (SINCE_KEY, "2026-11-29T15:00"))
        conn.commit()
    finally:
        conn.close()


def kinds_in(kind: DbKind) -> list[str]:
    conn = open_database(db_path(kind), kind)
    try:
        return [r[0] for r in conn.execute("SELECT kind FROM notifications ORDER BY id")]
    finally:
        conn.close()


def test_loop_makes_checkin_reminder_in_personal_only(data_dir):
    make_db(DbKind.PERSONAL)
    make_db(DbKind.SAMPLE)
    clock = lambda: datetime(2026, 11, 29, 16, 5, tzinfo=UTC)
    check_all_databases(clock, LOCAL)
    # The 29th is also past the statement due day, so that reminder comes too.
    assert kinds_in(DbKind.PERSONAL).count("checkin") == 1
    assert kinds_in(DbKind.SAMPLE) == []


def test_loop_without_a_plan_makes_no_checkin_reminder(data_dir):
    (data_dir / "settings" / "settings.toml").write_text(
        (Path(__file__).resolve().parents[1] / "settings.example.toml").read_text()
    )
    make_db(DbKind.PERSONAL)
    check_all_databases(lambda: datetime(2026, 11, 29, 16, 5, tzinfo=UTC), LOCAL)
    assert "checkin" not in kinds_in(DbKind.PERSONAL)
