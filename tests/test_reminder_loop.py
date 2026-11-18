"""Tests for the background reminder check (src/aicity/reminder_loop.py).

It checks every database file that exists (Personal and Sample), never creates
one, and one broken file never stops the other being checked.
"""

import time
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import pytest

from aicity import config
from aicity.db import DbKind, db_path, open_database
from aicity.main import create_app
from aicity.notifications import SINCE_KEY
from aicity.reminder_loop import ReminderLoop, check_all_databases
from aicity.tasks import TaskStore

LOCAL = ZoneInfo("Europe/London")
NOW = datetime(2026, 11, 18, 12, 0, tzinfo=UTC)


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv(config.DATA_DIR_ENV, str(tmp_path))
    return tmp_path


def clock() -> datetime:
    return NOW


def database_with_a_due_reminder(kind: DbKind) -> None:
    conn = open_database(db_path(kind), kind)
    try:
        conn.execute("INSERT INTO meta (key, value) VALUES (?, ?)", (SINCE_KEY, "2026-11-18T08:00"))
        conn.commit()
        TaskStore(conn, stale_after_days=7, clock=clock).create(
            title="Made-up reminder", category="personal", reminder_at="2026-11-18T11:00"
        )
    finally:
        conn.close()


def test_checks_both_databases_that_exist(data_dir):
    database_with_a_due_reminder(DbKind.PERSONAL)
    database_with_a_due_reminder(DbKind.SAMPLE)
    assert check_all_databases(clock, LOCAL) == {DbKind.PERSONAL: 1, DbKind.SAMPLE: 1}


def test_missing_database_file_is_skipped(data_dir):
    database_with_a_due_reminder(DbKind.SAMPLE)
    assert check_all_databases(clock, LOCAL) == {DbKind.SAMPLE: 1}
    assert not db_path(DbKind.PERSONAL).exists()


def test_a_broken_database_does_not_stop_the_other(data_dir):
    database_with_a_due_reminder(DbKind.SAMPLE)
    db_path(DbKind.PERSONAL).write_bytes(b"this is not a database")
    assert check_all_databases(clock, LOCAL) == {DbKind.SAMPLE: 1}


def test_loop_runs_at_start_and_stops_quickly():
    calls = []
    loop = ReminderLoop(clock, every_seconds=0.05, check=lambda c: calls.append(c()))
    loop.start()
    time.sleep(0.2)
    started = time.monotonic()
    loop.stop()
    assert time.monotonic() - started < 1
    assert len(calls) >= 1
    count = len(calls)
    time.sleep(0.15)
    assert len(calls) == count  # nothing runs after stop


def test_create_app_does_not_start_the_loop_by_default(data_dir):
    app = create_app(dev=False)
    assert getattr(app.state, "reminder_loop", None) is None


def test_background_app_starts_and_stops_the_loop(data_dir):
    from fastapi.testclient import TestClient

    app = create_app(dev=False, background=True)
    with TestClient(app, base_url="http://127.0.0.1:8765"):
        loop = app.state.reminder_loop
        assert loop is not None
        assert loop._thread is not None and loop._thread.is_alive()
    assert not loop._thread.is_alive()
