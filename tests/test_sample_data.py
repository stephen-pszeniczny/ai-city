"""Tests for the made-up Sample tasks (src/aicity/sample_data.py).

What matters: they only ever go into the Sample database, only once, and the
list they make has the mix a demo needs (due soon, overdue, stale, done, archived).
"""

import importlib.util
from collections import Counter
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from aicity import config
from aicity.db import DatabaseError, DbKind, db_path, open_database
from aicity.sample_data import SAMPLE_TASKS, reset_sample_database, seed, seed_sample_database
from aicity.tasks import TaskStore

NOW = datetime(2026, 11, 17, 15, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv(config.DATA_DIR_ENV, str(tmp_path))
    return tmp_path


def sample_store() -> TaskStore:
    conn = open_database(db_path(DbKind.SAMPLE), DbKind.SAMPLE)
    return TaskStore(conn, stale_after_days=7, clock=lambda: NOW)


def test_seeds_every_sample_task_once():
    assert seed_sample_database(clock=lambda: NOW) is True
    assert seed_sample_database(clock=lambda: NOW) is False  # second start adds nothing
    assert len(sample_store().list_tasks("all")) == len(SAMPLE_TASKS)


def test_sample_list_has_what_a_demo_needs():
    seed_sample_database(clock=lambda: NOW)
    tasks = sample_store().list_tasks("all")
    statuses = Counter(t.status for t in tasks)
    today = NOW.astimezone().date().isoformat()
    open_tasks = [t for t in tasks if t.status == "open"]

    assert statuses["done"] >= 1 and statuses["archived"] >= 1
    assert any(t.stale for t in open_tasks)
    assert any(t.goal_date and t.goal_date < today for t in open_tasks)  # overdue
    assert any(t.reminder_at for t in open_tasks)
    assert {t.category for t in tasks} == {"work", "side_work", "personal", "city"}


def test_timestamps_are_in_the_past_and_history_is_recorded():
    seed_sample_database(clock=lambda: NOW)
    store = sample_store()
    for task in store.list_tasks("all"):
        assert task.created_at <= task.updated_at
        assert store.history(task.id)[0].kind == "created"


def test_never_writes_into_the_personal_database():
    conn = open_database(db_path(DbKind.PERSONAL), DbKind.PERSONAL)
    try:
        with pytest.raises(DatabaseError):
            seed(conn, NOW)
        assert conn.execute("SELECT count(*) FROM tasks").fetchone() == (0,)
    finally:
        conn.close()


def test_refuses_a_personal_file_put_where_the_sample_file_goes():
    # A Personal-labelled file at the Sample path is refused by the label check.
    personal = open_database(db_path(DbKind.SAMPLE).with_name("other.db"), DbKind.PERSONAL)
    personal.close()
    db_path(DbKind.SAMPLE).parent.mkdir(parents=True, exist_ok=True)
    db_path(DbKind.SAMPLE).with_name("other.db").rename(db_path(DbKind.SAMPLE))
    with pytest.raises(DatabaseError):
        seed_sample_database(clock=lambda: NOW)


def test_tasks_already_in_the_sample_database_are_kept():
    store = sample_store()
    store.create(title="A task added by hand", category="personal")
    seed_sample_database(clock=lambda: NOW)
    titles = [t.title for t in sample_store().list_tasks("all")]
    assert "A task added by hand" in titles
    assert len(titles) == len(SAMPLE_TASKS) + 1


# --- Resetting --------------------------------------------------------------------------

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "reset_sample_data.py"
_spec = importlib.util.spec_from_file_location("reset_sample_data", SCRIPT)
reset_script = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(reset_script)


def titles() -> list[str]:
    return [t.title for t in sample_store().list_tasks("all")]


def test_reset_replaces_everything_with_fresh_sample_tasks():
    seed_sample_database(clock=lambda: NOW)
    sample_store().create(title="A task added by hand", category="personal")
    reset_sample_database(clock=lambda: NOW)
    assert sorted(titles()) == sorted(t.title for t in SAMPLE_TASKS)


def test_reset_with_no_sample_database_just_makes_one():
    assert not db_path(DbKind.SAMPLE).exists()
    reset_sample_database(clock=lambda: NOW)
    assert len(titles()) == len(SAMPLE_TASKS)


def test_reset_never_touches_the_personal_database():
    conn = open_database(db_path(DbKind.PERSONAL), DbKind.PERSONAL)
    TaskStore(conn, stale_after_days=7, clock=lambda: NOW).create(
        title="Keep me", category="personal"
    )
    conn.close()
    before = db_path(DbKind.PERSONAL).read_bytes()
    reset_sample_database(clock=lambda: NOW)
    assert db_path(DbKind.PERSONAL).read_bytes() == before


def test_reset_refuses_a_personal_file_at_the_sample_path_and_keeps_it():
    other = db_path(DbKind.SAMPLE).with_name("other.db")
    open_database(other, DbKind.PERSONAL).close()
    other.rename(db_path(DbKind.SAMPLE))
    before = db_path(DbKind.SAMPLE).read_bytes()
    with pytest.raises(DatabaseError):
        reset_sample_database(clock=lambda: NOW)
    assert db_path(DbKind.SAMPLE).read_bytes() == before


@pytest.mark.parametrize("contents", [b"", b"not a database at all"])
def test_reset_refuses_an_unlabelled_or_broken_file_and_keeps_it(contents):
    db_path(DbKind.SAMPLE).parent.mkdir(parents=True, exist_ok=True)
    db_path(DbKind.SAMPLE).write_bytes(contents)
    with pytest.raises(DatabaseError):
        reset_sample_database(clock=lambda: NOW)
    assert db_path(DbKind.SAMPLE).read_bytes() == contents


def test_reset_removes_sqlite_side_files(monkeypatch):
    seed_sample_database(clock=lambda: NOW)
    sides = [Path(f"{db_path(DbKind.SAMPLE)}{s}") for s in ("-wal", "-shm", "-journal")]
    for side in sides:
        side.write_bytes(b"old")
    # Look straight after the delete, before a new database is made (SQLite
    # would otherwise tidy some side files itself and hide a missed delete).
    monkeypatch.setattr("aicity.sample_data.seed_sample_database", lambda _clock: None)
    reset_sample_database(clock=lambda: NOW)
    assert not db_path(DbKind.SAMPLE).exists()
    assert [s.name for s in sides if s.exists()] == []


def test_script_does_nothing_unless_reset_is_typed():
    seed_sample_database(clock=lambda: NOW)
    sample_store().create(title="A task added by hand", category="personal")
    for answer in ("", "yes", "RESET", "y"):
        assert reset_script.main(ask=lambda _prompt, a=answer: a) == 1
    assert "A task added by hand" in titles()


def test_script_resets_when_reset_is_typed():
    seed_sample_database(clock=lambda: NOW)
    sample_store().create(title="A task added by hand", category="personal")
    assert reset_script.main(ask=lambda _prompt: "reset") == 0
    assert "A task added by hand" not in titles()


def test_script_reports_a_refusal_without_crashing():
    open_database(db_path(DbKind.SAMPLE).with_name("other.db"), DbKind.PERSONAL).close()
    db_path(DbKind.SAMPLE).with_name("other.db").rename(db_path(DbKind.SAMPLE))
    assert reset_script.main(ask=lambda _prompt: "reset") == 2


# --- Notifications: a demo reminder fires right after seeding ------------------------


def test_seed_sets_a_start_date_ten_minutes_back():
    from aicity.notifications import SINCE_KEY

    seed_sample_database(clock=lambda: NOW)
    conn = open_database(db_path(DbKind.SAMPLE), DbKind.SAMPLE)
    try:
        row = conn.execute("SELECT value FROM meta WHERE key = ?", (SINCE_KEY,)).fetchone()
    finally:
        conn.close()
    expected = (NOW.astimezone() - timedelta(minutes=10)).strftime("%Y-%m-%dT%H:%M")
    assert row == (expected,)


def test_first_check_after_seeding_makes_exactly_the_demo_notification():
    from aicity.notifications import NotificationStore

    seed_sample_database(clock=lambda: NOW)
    conn = open_database(db_path(DbKind.SAMPLE), DbKind.SAMPLE)
    try:
        store = NotificationStore(conn, clock=lambda: NOW)  # the Mac's own zone, like seeding
        store.check_reminders()
        assert [n.title for n in store.list_active()] == ["Water the balcony plants"]
    finally:
        conn.close()
