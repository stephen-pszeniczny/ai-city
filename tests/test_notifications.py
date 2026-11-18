"""Tests for the notification list and the reminder check (src/aicity/notifications.py).

The clock is fake and the local zone is fixed (Europe/London, which is UTC in
November), so "due" can be tested to the minute. Every database is temporary
and every task is made up.
"""

from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from aicity.db import DbKind, open_database
from aicity.notifications import (
    SINCE_KEY,
    NotificationConflict,
    NotificationNotFound,
    NotificationStore,
)
from aicity.tasks import TaskStore

LOCAL = ZoneInfo("Europe/London")
START = datetime(2026, 11, 18, 12, 0, tzinfo=UTC)  # 12:00 local


class FakeClock:
    def __init__(self, now: datetime) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now

    def at(self, hh: int, mm: int, ss: int = 0, day: int = 18) -> None:
        self.now = datetime(2026, 11, day, hh, mm, ss, tzinfo=UTC)


@pytest.fixture
def clock():
    return FakeClock(START)


@pytest.fixture
def conn(tmp_path):
    c = open_database(tmp_path / "sample.db", DbKind.SAMPLE)
    yield c
    c.close()


@pytest.fixture
def tasks(conn, clock):
    return TaskStore(conn, stale_after_days=7, clock=clock)


@pytest.fixture
def notes(conn, clock):
    return NotificationStore(conn, clock=clock, local_tz=LOCAL)


@pytest.fixture
def started(notes):
    """The first check has run at 12:00, so the start date is set."""
    notes.check_reminders()
    return notes


def add(tasks, title: str, reminder_at: str | None, notes_text: str = ""):
    return tasks.create(title=title, category="personal", notes=notes_text, reminder_at=reminder_at)


def active_titles(notes) -> list[str]:
    return [n.title for n in notes.list_active()]


def test_first_check_records_the_start_date_and_skips_older_reminders(conn, tasks, notes, clock):
    add(tasks, "Old reminder", "2026-11-10T09:00")
    assert notes.check_reminders() == 0
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (SINCE_KEY,)).fetchone()
    assert row == ("2026-11-18T12:00",)
    clock.at(15, 0)
    assert notes.check_reminders() == 0
    assert notes.list_active() == []


def test_reminder_due_after_start_creates_one_notification(tasks, started, clock):
    add(tasks, "Call the garage", "2026-11-18T12:30")
    clock.at(12, 31)
    assert started.check_reminders() == 1
    [n] = started.list_active()
    assert (n.kind, n.title, n.due_at, n.seen) == (
        "reminder",
        "Call the garage",
        "2026-11-18T12:30",
        False,
    )


def test_exactly_due_counts(tasks, started, clock):
    add(tasks, "On the minute", "2026-11-18T12:30")
    clock.at(12, 30, 0)
    assert started.check_reminders() == 1


def test_not_yet_due_creates_nothing(tasks, started, clock):
    add(tasks, "Later", "2026-11-18T12:30")
    clock.at(12, 29, 59)
    assert started.check_reminders() == 0


def test_checking_twice_never_duplicates(tasks, started, clock):
    add(tasks, "Once only", "2026-11-18T12:30")
    clock.at(12, 31)
    started.check_reminders()
    started.check_reminders()
    assert active_titles(started) == ["Once only"]


def test_several_due_at_once_all_appear_oldest_first(tasks, started, clock):
    for i, minute in enumerate([50, 10, 40, 20, 30]):
        add(tasks, f"Reminder {i}", f"2026-11-18T13:{minute:02}")
    clock.at(18, 0)  # the Mac was asleep all afternoon
    assert started.check_reminders() == 5
    assert [n.due_at[-2:] for n in started.list_active()] == ["10", "20", "30", "40", "50"]


def test_past_reminder_saved_after_start_fires_straight_away(tasks, started, clock):
    clock.at(13, 0)
    add(tasks, "Should have done this at 12:45", "2026-11-18T12:45")
    assert started.check_reminders() == 1


def test_finishing_or_archiving_the_task_clears_it(tasks, started, clock):
    done = add(tasks, "Finish me", "2026-11-18T12:30")
    gone = add(tasks, "Archive me", "2026-11-18T12:30")
    clock.at(12, 31)
    started.check_reminders()
    tasks.complete(done.id)
    tasks.archive(gone.id)
    started.check_reminders()
    assert started.list_active() == []


def test_editing_the_reminder_clears_the_old_and_fires_the_new_when_due(tasks, started, clock):
    t = add(tasks, "Moved", "2026-11-18T12:30")
    clock.at(12, 31)
    started.check_reminders()
    tasks.edit(t.id, reminder_at="2026-11-18T14:00")
    started.check_reminders()
    assert started.list_active() == []
    clock.at(14, 0)
    started.check_reminders()
    assert [n.due_at for n in started.list_active()] == ["2026-11-18T14:00"]


def test_removing_the_reminder_clears_it(tasks, started, clock):
    t = add(tasks, "No longer needed", "2026-11-18T12:30")
    clock.at(12, 31)
    started.check_reminders()
    tasks.edit(t.id, reminder_at=None)
    started.check_reminders()
    assert started.list_active() == []


def test_reopened_task_with_same_past_reminder_does_not_fire_again(tasks, started, clock):
    t = add(tasks, "Back again", "2026-11-18T12:30")
    clock.at(12, 31)
    started.check_reminders()
    tasks.complete(t.id)
    started.check_reminders()
    tasks.reopen(t.id)
    assert started.check_reminders() == 0
    assert started.list_active() == []


def test_seen_is_idempotent_and_shows_in_the_list(tasks, started, clock):
    add(tasks, "Look at me", "2026-11-18T12:30")
    clock.at(12, 31)
    started.check_reminders()
    [n] = started.list_active()
    started.mark_seen(n.id)
    started.mark_seen(n.id)
    assert started.list_active()[0].seen is True


def test_dismiss_hides_it_and_twice_is_a_conflict(tasks, started, clock):
    add(tasks, "Go away", "2026-11-18T12:30")
    clock.at(12, 31)
    started.check_reminders()
    [n] = started.list_active()
    started.dismiss(n.id)
    assert started.list_active() == []
    with pytest.raises(NotificationConflict):
        started.dismiss(n.id)


def test_unknown_id_is_not_found(started):
    with pytest.raises(NotificationNotFound):
        started.mark_seen(999)
    with pytest.raises(NotificationNotFound):
        started.dismiss(999)


def test_old_rows_are_deleted_once_their_reminder_is_gone(conn, tasks, started, clock):
    a = add(tasks, "Dismissed long ago, reminder since removed", "2026-11-18T12:30")
    b = add(tasks, "Dismissed recently", "2026-11-18T12:31")
    clock.at(12, 32)
    started.check_reminders()
    ids = {n.task_id: n.id for n in started.list_active()}
    started.dismiss(ids[a.id])
    tasks.edit(a.id, reminder_at=None)  # nothing could recreate its row now
    clock.now += timedelta(days=2)
    started.dismiss(ids[b.id])
    tasks.edit(b.id, reminder_at=None)
    clock.now = START + timedelta(days=91, minutes=10)
    started.check_reminders()
    left = {r[0] for r in conn.execute("SELECT task_id FROM notifications")}
    assert left == {b.id}
    assert a.id not in left


def test_notes_are_never_copied(conn, tasks, started, clock):
    add(tasks, "Private bits", "2026-11-18T12:30", notes_text="SECRET-NOTE-TEXT")
    clock.at(12, 31)
    started.check_reminders()
    for row in conn.execute("SELECT * FROM notifications"):
        assert all("SECRET-NOTE-TEXT" not in str(v) for v in row)


def test_dismissed_reminder_never_fires_again_after_the_90_day_cleanup(tasks, started, clock):
    add(tasks, "Pay rent", "2026-11-18T12:30")
    clock.at(12, 31)
    started.check_reminders()
    [n] = started.list_active()
    started.dismiss(n.id)
    clock.now = START + timedelta(days=91)
    started.check_reminders()  # the cleanup runs here
    clock.now += timedelta(seconds=30)
    assert started.check_reminders() == 0
    assert started.list_active() == []


def test_reopened_after_90_days_does_not_fire_again(tasks, started, clock):
    t = add(tasks, "Back after a long time", "2026-11-18T12:30")
    clock.at(12, 31)
    started.check_reminders()
    tasks.complete(t.id)
    started.check_reminders()
    clock.now = START + timedelta(days=91)
    started.check_reminders()
    tasks.reopen(t.id)
    assert started.check_reminders() == 0
