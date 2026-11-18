"""Tests for the made-up Sample tasks (src/aicity/sample_data.py).

What matters: they only ever go into the Sample database, only once, and the
list they make has the mix a demo needs (due soon, overdue, stale, done, archived).
"""

from collections import Counter
from datetime import UTC, datetime

import pytest

from aicity import config
from aicity.db import DatabaseError, DbKind, db_path, open_database
from aicity.sample_data import SAMPLE_TASKS, seed, seed_sample_database
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
