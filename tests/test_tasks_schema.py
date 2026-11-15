"""Tests for migration 002: the tasks and task_history tables.

These check the rules the database itself enforces, so bad data is refused
even if a bug in the app tries to write it. Every database here is temporary.
"""

import sqlite3

import pytest

from aicity.db import DbKind, open_database

NOW = "2026-11-15T21:00:00Z"


@pytest.fixture
def conn(tmp_path):
    c = open_database(tmp_path / "sample.db", DbKind.SAMPLE)
    yield c
    c.close()


def add_task(conn, **overrides):
    row = {
        "title": "Example task",
        "notes": "",
        "category": "personal",
        "goal_date": None,
        "reminder_at": None,
        "status": "open",
        "created_at": NOW,
        "updated_at": NOW,
        "completed_at": None,
    }
    row.update(overrides)
    cols = ", ".join(row)
    marks = ", ".join("?" for _ in row)
    cur = conn.execute(f"INSERT INTO tasks ({cols}) VALUES ({marks})", tuple(row.values()))
    return cur.lastrowid


def add_event(conn, task_id, kind="created", changes="{}"):
    conn.execute(
        "INSERT INTO task_history (task_id, at, kind, changes) VALUES (?, ?, ?, ?)",
        (task_id, NOW, kind, changes),
    )


# --- Valid data is accepted --------------------------------------------------


def test_a_full_valid_task_is_accepted(conn):
    task_id = add_task(
        conn,
        notes="Some notes",
        category="work",
        goal_date="2026-12-01",
        reminder_at="2026-11-30T09:00",
    )
    assert conn.execute("SELECT title FROM tasks WHERE id = ?", (task_id,)).fetchone() == (
        "Example task",
    )


@pytest.mark.parametrize("category", ["work", "side_work", "personal", "city"])
def test_every_category_is_accepted(conn, category):
    add_task(conn, category=category)


def test_done_task_with_completion_time_is_accepted(conn):
    add_task(conn, status="done", completed_at=NOW)


def test_archived_task_is_accepted(conn):
    add_task(conn, status="archived")


# --- Bad data is refused -----------------------------------------------------


@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param({"title": ""}, id="empty title"),
        pytest.param({"title": "   "}, id="blank title"),
        pytest.param({"title": " padded"}, id="untrimmed title"),
        pytest.param({"title": "x" * 201}, id="title too long"),
        pytest.param({"title": None}, id="no title"),
        pytest.param({"notes": "x" * 5001}, id="notes too long"),
        pytest.param({"notes": None}, id="null notes"),
        pytest.param({"category": "other"}, id="unknown category"),
        pytest.param({"category": "Work"}, id="category wrong case"),
        pytest.param({"status": "deleted"}, id="unknown status"),
        pytest.param({"goal_date": "2026-02-30"}, id="impossible date"),
        pytest.param({"goal_date": "2026-1-5"}, id="unpadded date"),
        pytest.param({"goal_date": "next week"}, id="text date"),
        pytest.param({"reminder_at": "2026-11-30 09:00"}, id="reminder missing T"),
        pytest.param({"reminder_at": "2026-11-30T25:00"}, id="reminder bad hour"),
        pytest.param({"reminder_at": "2026-11-30T09:00:00"}, id="reminder with seconds"),
        pytest.param({"created_at": "2026-11-15 21:00:00"}, id="timestamp not UTC form"),
        pytest.param({"updated_at": "yesterday"}, id="timestamp text"),
        pytest.param({"status": "done"}, id="done without completion time"),
        pytest.param({"completed_at": NOW}, id="open with completion time"),
        pytest.param({"status": "archived", "completed_at": NOW}, id="archived with completion"),
        pytest.param({"updated_at": "2026-11-15T20:00:00Z"}, id="changed before created"),
    ],
)
def test_bad_task_is_refused(conn, overrides):
    with pytest.raises(sqlite3.IntegrityError):
        add_task(conn, **overrides)


def test_wrong_type_is_refused(conn):
    # STRICT tables refuse raw binary data where text belongs. (Numbers are
    # converted to text without loss, so SQLite allows those.)
    with pytest.raises(sqlite3.IntegrityError):
        add_task(conn, title=b"binary")


# --- Tasks are never deleted -------------------------------------------------


def test_deleting_a_task_is_refused(conn):
    task_id = add_task(conn)
    with pytest.raises(sqlite3.IntegrityError, match="archive"):
        conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    assert conn.execute("SELECT COUNT(*) FROM tasks").fetchone() == (1,)


# --- History is permanent ----------------------------------------------------


def test_history_event_is_recorded(conn):
    task_id = add_task(conn)
    add_event(conn, task_id, "edited", '{"title": ["Old", "New"]}')
    assert conn.execute("SELECT kind FROM task_history").fetchall() == [("edited",)]


def test_editing_history_is_refused(conn):
    task_id = add_task(conn)
    add_event(conn, task_id)
    with pytest.raises(sqlite3.IntegrityError, match="permanent"):
        conn.execute("UPDATE task_history SET kind = 'edited'")
    assert conn.execute("SELECT kind FROM task_history").fetchall() == [("created",)]


def test_deleting_history_is_refused(conn):
    task_id = add_task(conn)
    add_event(conn, task_id)
    with pytest.raises(sqlite3.IntegrityError, match="permanent"):
        conn.execute("DELETE FROM task_history")
    assert conn.execute("SELECT COUNT(*) FROM task_history").fetchone() == (1,)


@pytest.mark.parametrize(
    ("kind", "changes"),
    [
        pytest.param("renamed", "{}", id="unknown kind"),
        pytest.param("edited", "not json", id="changes not JSON"),
        pytest.param("edited", "[1, 2]", id="changes not an object"),
    ],
)
def test_bad_history_event_is_refused(conn, kind, changes):
    task_id = add_task(conn)
    with pytest.raises(sqlite3.IntegrityError):
        add_event(conn, task_id, kind, changes)


def test_history_for_missing_task_is_refused(conn):
    with pytest.raises(sqlite3.IntegrityError):
        add_event(conn, 999)
