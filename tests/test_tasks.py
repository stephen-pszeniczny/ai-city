"""Tests for the to-do list logic (src/aicity/tasks.py).

The clock is fake, so stale checks can be tested to the second.
Every database here is temporary.
"""

from datetime import UTC, datetime, timedelta

import pytest

from aicity.db import DbKind, open_database
from aicity.tasks import TaskError, TaskNotFound, TaskStore

START = datetime(2026, 11, 15, 21, 0, 0, tzinfo=UTC)
STALE_DAYS = 7


class FakeClock:
    def __init__(self, now: datetime) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **kwargs) -> None:
        self.now += timedelta(**kwargs)


@pytest.fixture
def clock():
    return FakeClock(START)


@pytest.fixture
def conn(tmp_path):
    c = open_database(tmp_path / "sample.db", DbKind.SAMPLE)
    yield c
    c.close()


@pytest.fixture
def store(conn, clock):
    return TaskStore(conn, stale_after_days=STALE_DAYS, clock=clock)


def history_kinds(store, task_id):
    return [e.kind for e in store.history(task_id)]


# --- Creating ----------------------------------------------------------------


def test_create_returns_the_new_task(store):
    task = store.create(title="Book dentist", category="personal")
    assert task.id > 0
    assert task.title == "Book dentist"
    assert task.category == "personal"
    assert task.notes == ""
    assert task.goal_date is None
    assert task.reminder_at is None
    assert task.status == "open"
    assert task.created_at == task.updated_at == "2026-11-15T21:00:00Z"
    assert task.completed_at is None
    assert task.stale is False


def test_create_with_every_field(store):
    task = store.create(
        title="Send invoice",
        category="side_work",
        notes="Details here",
        goal_date="2026-12-01",
        reminder_at="2026-11-30T09:00",
    )
    assert (task.notes, task.goal_date, task.reminder_at) == (
        "Details here",
        "2026-12-01",
        "2026-11-30T09:00",
    )


def test_create_trims_the_title(store):
    assert store.create(title="  Padded  ", category="city").title == "Padded"


def test_create_records_starting_values_in_history(store):
    task = store.create(title="New", category="work", goal_date="2026-12-01")
    [event] = store.history(task.id)
    assert event.kind == "created"
    assert event.at == "2026-11-15T21:00:00Z"
    assert event.changes["title"] == [None, "New"]
    assert event.changes["goal_date"] == [None, "2026-12-01"]


@pytest.mark.parametrize(
    "kwargs",
    [
        pytest.param({"title": "   ", "category": "work"}, id="blank title"),
        pytest.param({"title": "x", "category": "nope"}, id="bad category"),
        pytest.param({"title": "x", "category": "work", "goal_date": "2026-02-30"}, id="bad date"),
    ],
)
def test_bad_create_is_refused_and_nothing_saved(store, conn, kwargs):
    with pytest.raises(TaskError):
        store.create(**kwargs)
    assert conn.execute("SELECT COUNT(*) FROM tasks").fetchone() == (0,)
    assert conn.execute("SELECT COUNT(*) FROM task_history").fetchone() == (0,)


# --- Reading -----------------------------------------------------------------


def test_get_missing_task_raises_not_found(store):
    with pytest.raises(TaskNotFound):
        store.get(999)


def test_list_defaults_to_open_tasks(store):
    a = store.create(title="A", category="work")
    b = store.create(title="B", category="work")
    store.complete(b.id)
    c = store.create(title="C", category="work")
    store.archive(c.id)
    assert [t.title for t in store.list_tasks()] == ["A"]
    assert [t.title for t in store.list_tasks("done")] == ["B"]
    assert [t.title for t in store.list_tasks("archived")] == ["C"]
    assert sorted(t.title for t in store.list_tasks("all")) == ["A", "B", "C"]
    assert a.id != b.id != c.id


def test_list_orders_by_goal_date_then_newest_undated_last(store):
    store.create(title="No date", category="work")
    store.create(title="Later", category="work", goal_date="2026-12-10")
    store.create(title="Sooner", category="work", goal_date="2026-12-01")
    assert [t.title for t in store.list_tasks()] == ["Sooner", "Later", "No date"]


def test_list_unknown_status_is_refused(store):
    with pytest.raises(TaskError):
        store.list_tasks("deleted")


# --- Editing -----------------------------------------------------------------


def test_edit_changes_fields_and_records_old_and_new(store, clock):
    task = store.create(title="Old", category="work")
    clock.advance(hours=1)
    edited = store.edit(task.id, title="New", goal_date="2026-12-01")
    assert edited.title == "New"
    assert edited.goal_date == "2026-12-01"
    assert edited.updated_at == "2026-11-15T22:00:00Z"
    event = store.history(task.id)[-1]
    assert event.kind == "edited"
    assert event.changes == {"title": ["Old", "New"], "goal_date": [None, "2026-12-01"]}


def test_edit_can_clear_optional_fields(store):
    task = store.create(title="T", category="work", goal_date="2026-12-01")
    assert store.edit(task.id, goal_date=None).goal_date is None


def test_edit_with_no_real_change_records_nothing(store, clock):
    task = store.create(title="Same", category="work")
    clock.advance(days=1)
    again = store.edit(task.id, title="Same")
    assert again.updated_at == task.updated_at
    assert history_kinds(store, task.id) == ["created"]


def test_edit_unknown_field_is_refused(store):
    task = store.create(title="T", category="work")
    with pytest.raises(TaskError):
        store.edit(task.id, status="done")


def test_bad_edit_is_refused_and_nothing_changes(store):
    task = store.create(title="T", category="work")
    with pytest.raises(TaskError):
        store.edit(task.id, title="ok", category="nope")
    assert store.get(task.id).title == "T"
    assert history_kinds(store, task.id) == ["created"]


def test_editing_archived_task_is_refused(store):
    task = store.create(title="T", category="work")
    store.archive(task.id)
    with pytest.raises(TaskError):
        store.edit(task.id, title="New")


def test_edit_missing_task_raises_not_found(store):
    with pytest.raises(TaskNotFound):
        store.edit(999, title="x")


# --- Complete, reopen, archive -------------------------------------------------


def test_complete_sets_status_and_time(store, clock):
    task = store.create(title="T", category="work")
    clock.advance(minutes=5)
    done = store.complete(task.id)
    assert done.status == "done"
    assert done.completed_at == "2026-11-15T21:05:00Z"
    assert store.history(task.id)[-1].changes == {"status": ["open", "done"]}


def test_reopen_done_task(store):
    task = store.create(title="T", category="work")
    store.complete(task.id)
    reopened = store.reopen(task.id)
    assert (reopened.status, reopened.completed_at) == ("open", None)


def test_archive_and_restore(store):
    task = store.create(title="T", category="work")
    store.complete(task.id)
    archived = store.archive(task.id)
    assert (archived.status, archived.completed_at) == ("archived", None)
    assert store.reopen(task.id).status == "open"
    assert history_kinds(store, task.id) == ["created", "completed", "archived", "reopened"]


@pytest.mark.parametrize(
    ("setup", "action"),
    [
        pytest.param(["complete"], "complete", id="complete twice"),
        pytest.param([], "reopen", id="reopen an open task"),
        pytest.param(["archive"], "archive", id="archive twice"),
        pytest.param(["archive"], "complete", id="complete an archived task"),
    ],
)
def test_invalid_status_change_is_refused(store, setup, action):
    task = store.create(title="T", category="work")
    for step in setup:
        getattr(store, step)(task.id)
    before = history_kinds(store, task.id)
    with pytest.raises(TaskError):
        getattr(store, action)(task.id)
    assert history_kinds(store, task.id) == before


@pytest.mark.parametrize("action", ["complete", "reopen", "archive", "history"])
def test_actions_on_missing_task_raise_not_found(store, action):
    with pytest.raises(TaskNotFound):
        getattr(store, action)(999)


# --- Stale -------------------------------------------------------------------


def test_task_just_under_threshold_is_not_stale(store, clock):
    task = store.create(title="T", category="work")
    clock.advance(days=STALE_DAYS, seconds=-1)
    assert store.get(task.id).stale is False


def test_task_at_threshold_is_stale(store, clock):
    task = store.create(title="T", category="work")
    clock.advance(days=STALE_DAYS)
    assert store.get(task.id).stale is True
    assert store.list_tasks()[0].stale is True


def test_editing_clears_stale(store, clock):
    task = store.create(title="T", category="work")
    clock.advance(days=STALE_DAYS + 3)
    assert store.edit(task.id, notes="Still on it").stale is False


@pytest.mark.parametrize("action", ["complete", "archive"])
def test_closed_tasks_are_never_stale(store, clock, action):
    task = store.create(title="T", category="work")
    getattr(store, action)(task.id)
    clock.advance(days=100)
    assert store.get(task.id).stale is False


def test_threshold_comes_from_settings(conn, clock):
    store = TaskStore(conn, stale_after_days=2, clock=clock)
    task = store.create(title="T", category="work")
    clock.advance(days=2)
    assert store.get(task.id).stale is True


# --- History -----------------------------------------------------------------


def test_history_is_oldest_first_and_complete(store):
    task = store.create(title="T", category="work")
    store.edit(task.id, title="T2")
    store.complete(task.id)
    store.reopen(task.id)
    store.archive(task.id)
    assert history_kinds(store, task.id) == [
        "created",
        "edited",
        "completed",
        "reopened",
        "archived",
    ]


def test_clock_must_be_timezone_aware(conn):
    store = TaskStore(conn, stale_after_days=7, clock=lambda: datetime(2026, 11, 15))
    with pytest.raises(ValueError):
        store.create(title="T", category="work")


def test_task_change_is_undone_if_history_cannot_be_saved(store, monkeypatch):
    task = store.create(title="T", category="work")

    def broken_record(*_args):
        raise RuntimeError("history write failed")

    monkeypatch.setattr(store, "_record", broken_record)
    with pytest.raises(RuntimeError):
        store.edit(task.id, title="Changed")
    with pytest.raises(RuntimeError):
        store.complete(task.id)
    with pytest.raises(RuntimeError):
        store.create(title="Second", category="work")
    monkeypatch.undo()
    assert store.get(task.id).title == "T"
    assert store.get(task.id).status == "open"
    assert [t.title for t in store.list_tasks("all")] == ["T"]
