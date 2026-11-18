"""Made-up to-do tasks for Sample mode, so screenshots and demos look lived-in.

Everything here is invented. No real tasks, names or details, ever.

seed_sample_database() fills the Sample database once (a meta row,
sample_seeded, remembers it's done) and only ever opens the file labelled
'sample': open_database refuses a Personal file, so real data can't be touched.
Dates are set relative to today, so the list always has something due soon,
something overdue, something stale, some done and one archived.

It runs when the app starts (scripts/run_app.py), not on each request, so a
fresh database in tests stays empty.
"""

import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

from aicity.db import DatabaseError, DbKind, db_path, open_database, with_transaction
from aicity.tasks import TaskStore, utc_now

SEEDED_KEY = "sample_seeded"


@dataclass(frozen=True)
class SampleTask:
    title: str
    category: str  # work, side_work, personal, city
    created_days_ago: int
    goal_in_days: int | None = None  # negative = overdue
    notes: str = ""
    reminder_in_days: int | None = None  # reminder at 9:00 that day
    finished_days_ago: int | None = None  # set with status
    status: str = "open"  # open, done, archived


SAMPLE_TASKS: tuple[SampleTask, ...] = (
    SampleTask("Prepare weekly status update", "work", 3, goal_in_days=2),
    SampleTask(
        "Review onboarding checklist",
        "work",
        20,
        notes="Untouched for a while, so it shows as stale.",
    ),
    SampleTask(
        "Log this week's side-work hours", "side_work", 2, goal_in_days=1, reminder_in_days=1
    ),
    SampleTask("Update rate card for contract work", "side_work", 5, goal_in_days=6),
    SampleTask("Return borrowed camera tripod", "personal", 9, goal_in_days=-2),
    SampleTask("Book dentist appointment", "personal", 4, goal_in_days=3),
    SampleTask("Renew library card", "personal", 1, goal_in_days=9),
    SampleTask("Plan a weekend hike", "personal", 2, notes="Pick a trail and check the weather."),
    SampleTask(
        "Buy a birthday card",
        "personal",
        6,
        goal_in_days=-1,
        status="done",
        finished_days_ago=1,
    ),
    SampleTask("Sketch the Training Bay landmark", "city", 3, goal_in_days=12),
    SampleTask("List the README screenshots", "city", 1),
    SampleTask("Try warmer night-mode colours", "city", 8, status="archived", finished_days_ago=4),
)


class _StepClock:
    """A clock the seeder moves around, so tasks get believable past timestamps."""

    def __init__(self, now: datetime) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now


def seed_sample_database(clock: Callable[[], datetime] = utc_now) -> bool:
    """Fill the Sample database with SAMPLE_TASKS once. True if it seeded now."""
    conn = open_database(db_path(DbKind.SAMPLE), DbKind.SAMPLE)
    try:
        return seed(conn, clock())
    finally:
        conn.close()


def reset_sample_database(clock: Callable[[], datetime] = utc_now) -> None:
    """Delete the Sample database and make it again with fresh made-up tasks.

    Before deleting, the file's own label is read (read-only) and must say
    'sample'. A file labelled anything else, or with no label, is refused and
    left exactly as it was. The Personal database is never opened.
    """
    path = db_path(DbKind.SAMPLE)
    if path == db_path(DbKind.PERSONAL):  # can't happen; checked anyway
        raise DatabaseError("The Sample and Personal paths are the same. Refusing to reset.")
    if path.exists():
        if _read_label(path) != DbKind.SAMPLE.value:
            raise DatabaseError("That file isn't labelled Sample. Nothing was deleted.")
        # SQLite's side files go too, or the old data could come back.
        for suffix in ("", "-wal", "-shm", "-journal"):
            Path(f"{path}{suffix}").unlink(missing_ok=True)
    seed_sample_database(clock)


def _read_label(path: Path) -> str | None:
    """The db_kind label of a database file, read without changing it. None if unreadable."""
    try:
        # immutable=1: read the file alone, ignoring leftover side files (-wal,
        # -journal) that would otherwise stop a read-only open. The label is
        # written once when the file is made, so side files can't change it.
        conn = sqlite3.connect(f"{path.as_uri()}?mode=ro&immutable=1", uri=True)
    except sqlite3.Error:
        return None
    try:
        row = conn.execute("SELECT value FROM meta WHERE key = 'db_kind'").fetchone()
    except sqlite3.Error:
        return None
    finally:
        conn.close()
    return None if row is None else row[0]


def seed(conn: sqlite3.Connection, now: datetime) -> bool:
    """Add the sample tasks to this connection, once. Refuses anything not labelled Sample."""
    label = conn.execute("SELECT value FROM meta WHERE key = 'db_kind'").fetchone()
    if label is None or label[0] != DbKind.SAMPLE.value:
        raise DatabaseError("Sample tasks only go into the Sample database.")
    if _already_seeded(conn):
        return False
    today = now.astimezone().date()  # goal dates and reminders are local Mac days
    step = _StepClock(now)
    # stale_after_days only affects reading, not what's written.
    store = TaskStore(conn, stale_after_days=7, clock=step)

    for t in SAMPLE_TASKS:
        step.now = now - timedelta(days=t.created_days_ago)
        goal = None if t.goal_in_days is None else (today + timedelta(t.goal_in_days)).isoformat()
        reminder = (
            None
            if t.reminder_in_days is None
            else f"{(today + timedelta(t.reminder_in_days)).isoformat()}T09:00"
        )
        task = store.create(
            title=t.title, category=t.category, notes=t.notes, goal_date=goal, reminder_at=reminder
        )
        if t.status != "open":
            step.now = now - timedelta(days=t.finished_days_ago or 0)
            (store.complete if t.status == "done" else store.archive)(task.id)

    with_transaction(
        conn,
        lambda: conn.execute("INSERT INTO meta (key, value) VALUES (?, '1')", (SEEDED_KEY,)),
    )
    return True


def _already_seeded(conn: sqlite3.Connection) -> bool:
    row = conn.execute("SELECT 1 FROM meta WHERE key = ?", (SEEDED_KEY,)).fetchone()
    return row is not None
