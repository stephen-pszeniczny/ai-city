"""Tests for the monthly "import last month's statement" reminder
(src/aicity/statement_reminder.py), migration 007, and its place in the reminder loop.

Every database is temporary and every value invented. Due day 8, reminder time 09:00.
"""

import logging
from datetime import UTC, date, datetime, time
from zoneinfo import ZoneInfo

import pytest

from aicity import config
from aicity.db import DbKind, db_path, load_migrations, migrate, open_database
from aicity.income import IncomeStore
from aicity.notifications import SINCE_KEY, NotificationStore
from aicity.reminder_loop import check_all_databases
from aicity.settings import SettingsError, load_settings
from aicity.statement_reminder import STATEMENT_TITLE, check_statement_reminder
from aicity.tasks import TaskStore

LOCAL = ZoneInfo("Europe/London")  # UTC in December
NINE = time(9, 0)
STAMP = datetime(2026, 12, 8, 9, 0, tzinfo=UTC)


@pytest.fixture
def conn(tmp_path):
    c = open_database(tmp_path / "personal.db", DbKind.PERSONAL)
    yield c
    c.close()


def at(day: int, hh: int, mm: int = 0, month: int = 12) -> datetime:
    return datetime(2026, month, day, hh, mm, tzinfo=LOCAL)


def check(conn, now: datetime, reminder_time: time = NINE) -> int:
    return check_statement_reminder(conn, now, 8, reminder_time, now.astimezone(UTC))


def active(conn) -> list[tuple]:
    return conn.execute(
        "SELECT kind, task_id, title, due_at FROM notifications "
        "WHERE dismissed_at IS NULL AND cleared_at IS NULL ORDER BY id"
    ).fetchall()


def import_november(conn) -> None:
    IncomeStore(conn, clock=lambda: STAMP).record_import(
        first_day=date(2026, 11, 1),
        last_day=date(2026, 11, 30),
        kept=0,
        duplicates=0,
        skipped=0,
        spending=0,
    )


# --- Migration 007 --------------------------------------------------------------------------


def test_007_keeps_existing_notifications(tmp_path):
    conn = open_database(tmp_path / "personal.db", DbKind.PERSONAL, load_migrations()[:6])
    task = TaskStore(conn, stale_after_days=7, clock=lambda: STAMP).create(
        title="Made-up task", category="personal", reminder_at="2026-12-08T09:00"
    )
    conn.execute(
        "INSERT INTO notifications (id, kind, task_id, title, due_at, created_at, seen_at)"
        " VALUES (5, 'reminder', ?, 'Made-up task', '2026-12-08T09:00',"
        " '2026-12-08T09:00:00Z', '2026-12-08T09:01:00Z')",
        (task.id,),
    )
    conn.commit()
    before = conn.execute("SELECT * FROM notifications").fetchall()
    migrate(conn, load_migrations()[:7])
    assert conn.execute("SELECT * FROM notifications").fetchall() == before
    conn.close()


def test_statement_notification_has_no_task(conn):
    task = TaskStore(conn, stale_after_days=7, clock=lambda: STAMP).create(
        title="Made-up task", category="personal"
    )
    with pytest.raises(Exception, match="CHECK"):
        conn.execute(
            "INSERT INTO notifications (kind, task_id, title, due_at, created_at)"
            " VALUES ('statement', ?, 'x', '2026-12-08T09:00', '2026-12-08T09:00:00Z')",
            (task.id,),
        )


# --- The check ------------------------------------------------------------------------------


def test_statement_reminder_fires_on_due_day_at_reminder_time(conn):
    assert check(conn, at(8, 8, 59)) == 0
    assert check(conn, at(8, 9, 0)) == 1
    assert active(conn) == [("statement", None, STATEMENT_TITLE, "2026-12-08T09:00")]


def test_statement_reminder_not_before_due_day(conn):
    assert check(conn, at(7, 23, 59)) == 0
    assert active(conn) == []


def test_statement_reminder_later_in_the_month_still_fires(conn):
    assert check(conn, at(19, 8, 0)) == 0  # before the reminder time that day
    assert check(conn, at(19, 9, 30)) == 1  # the app was closed on the 8th


def test_statement_reminder_once_per_month_even_after_dismiss_or_time_change(conn):
    check(conn, at(8, 9, 0))
    notes = NotificationStore(conn, clock=lambda: STAMP, local_tz=LOCAL)
    [n] = notes.list_active()
    notes.dismiss(n.id)
    assert check(conn, at(8, 9, 5)) == 0
    assert check(conn, at(8, 11, 0), reminder_time=time(10, 0)) == 0
    assert check(conn, at(20, 11, 0)) == 0
    assert active(conn) == []


def test_statement_reminder_cleared_by_import(conn):
    check(conn, at(8, 9, 0))
    import_november(conn)
    assert check(conn, at(8, 9, 1)) == 0
    assert active(conn) == []
    cleared = conn.execute("SELECT cleared_at FROM notifications").fetchone()[0]
    assert cleared is not None


def test_no_statement_reminder_when_last_month_is_imported(conn):
    import_november(conn)
    assert check(conn, at(8, 9, 0)) == 0
    assert conn.execute("SELECT count(*) FROM notifications").fetchone()[0] == 0


def test_statement_reminder_fires_again_next_month(conn):
    check(conn, at(8, 9, 0))
    import_november(conn)
    check(conn, at(9, 9, 0))  # clears December's
    assert check(conn, at(8, 9, 0, month=1).replace(year=2027)) == 1
    assert [row[3] for row in active(conn)] == ["2027-01-08T09:00"]


def test_task_reminder_check_leaves_statement_reminders_alone(conn):
    check(conn, at(8, 9, 0))
    NotificationStore(conn, clock=lambda: STAMP, local_tz=LOCAL).check_reminders()
    assert [row[0] for row in active(conn)] == ["statement"]


# --- In the reminder loop -------------------------------------------------------------------


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv(config.DATA_DIR_ENV, str(tmp_path))
    return tmp_path


def loop_clock() -> datetime:
    return STAMP


class FakeSettings:
    class income:
        statement_due_day = 8

    class tasks:
        reminder_time = NINE


def make_db(kind: DbKind, task_reminder: bool = False) -> None:
    conn = open_database(db_path(kind), kind)
    try:
        conn.execute("INSERT INTO meta (key, value) VALUES (?, ?)", (SINCE_KEY, "2026-12-08T08:00"))
        conn.commit()
        if task_reminder:
            TaskStore(conn, stale_after_days=7, clock=loop_clock).create(
                title="Made-up reminder", category="personal", reminder_at="2026-12-08T08:30"
            )
    finally:
        conn.close()


def kinds_in(kind: DbKind) -> list[str]:
    conn = open_database(db_path(kind), kind)
    try:
        return [r[0] for r in conn.execute("SELECT kind FROM notifications ORDER BY id")]
    finally:
        conn.close()


def test_statement_reminder_only_in_personal(data_dir):
    make_db(DbKind.PERSONAL)
    make_db(DbKind.SAMPLE)
    made = check_all_databases(loop_clock, LOCAL, load=FakeSettings)
    assert made == {DbKind.PERSONAL: 1, DbKind.SAMPLE: 0}
    assert kinds_in(DbKind.PERSONAL) == ["statement"]
    assert kinds_in(DbKind.SAMPLE) == []


def test_statement_reminder_goes_to_mac_notify(data_dir):
    make_db(DbKind.PERSONAL, task_reminder=True)
    told = []
    check_all_databases(loop_clock, LOCAL, notify=told.append, load=FakeSettings)
    [batch] = told
    assert [n.kind for n in batch] == ["reminder", "statement"]
    assert batch[1].title == STATEMENT_TITLE


def test_bad_settings_still_makes_task_reminders(data_dir, caplog):
    make_db(DbKind.PERSONAL, task_reminder=True)

    def broken():
        raise SettingsError("secret-ish detail")

    with caplog.at_level(logging.WARNING):
        made = check_all_databases(loop_clock, LOCAL, load=broken)
    assert made == {DbKind.PERSONAL: 1}
    assert kinds_in(DbKind.PERSONAL) == ["reminder"]
    assert "SettingsError" in caplog.text
    assert "secret-ish detail" not in caplog.text


def test_the_loop_reads_the_real_settings_by_default():
    import inspect

    assert inspect.signature(check_all_databases).parameters["load"].default is load_settings
