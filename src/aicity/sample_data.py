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
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

from aicity.db import DatabaseError, DbKind, db_path, open_database, with_transaction
from aicity.fx import rate_on
from aicity.notifications import SINCE_KEY
from aicity.settings import IncomeSettings, PaySchedule
from aicity.side_work import SideWorkStore
from aicity.side_work_math import expected_cents, pay_period, rate_text
from aicity.tasks import TaskStore, utc_now

SEEDED_KEY = "sample_seeded"

# Sample mode's own side-work settings, so demos never show the private settings.
SAMPLE_PAY_SCHEDULES: dict[str, PaySchedule] = {
    "sample_a": PaySchedule("sample_a", "Nimbus Labs", 5, (5, 6), (3, 4)),
}
SAMPLE_INCOME = IncomeSettings(tax_set_aside_percent=Decimal(20), tax_set_aside_is_placeholder=True)


@dataclass(frozen=True)
class SampleTask:
    title: str
    category: str  # work, side_work, personal, city
    created_days_ago: int
    goal_in_days: int | None = None  # negative = overdue
    notes: str = ""
    reminder_in_days: int | None = None  # reminder at 9:00 that day
    reminder_minutes_ago: int | None = None  # reminder this many minutes before seeding
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
    # Its reminder is just before seeding, so a demo shows the shuttle right after a reset.
    SampleTask("Water the balcony plants", "personal", 1, reminder_minutes_ago=2),
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
        now = clock()
        seeded = seed(conn, now)
        # Its own once-only check, so a Sample database made before the Vault gets it too.
        seed_side_work(conn, now)
        return seeded
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
        if t.reminder_minutes_ago is not None:
            reminder = _local_minute(now - timedelta(minutes=t.reminder_minutes_ago))
        elif t.reminder_in_days is not None:
            reminder = f"{(today + timedelta(t.reminder_in_days)).isoformat()}T09:00"
        else:
            reminder = None
        task = store.create(
            title=t.title, category=t.category, notes=t.notes, goal_date=goal, reminder_at=reminder
        )
        if t.status != "open":
            step.now = now - timedelta(days=t.finished_days_ago or 0)
            (store.complete if t.status == "done" else store.archive)(task.id)

    def mark_seeded() -> None:
        conn.execute("INSERT INTO meta (key, value) VALUES (?, '1')", (SEEDED_KEY,))
        # Notifications start 10 minutes back, so the demo reminder above fires on the
        # first check while the other made-up reminders (days away) don't.
        conn.execute(
            "INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
            (SINCE_KEY, _local_minute(now - timedelta(minutes=10))),
        )

    with_transaction(conn, mark_seeded)
    return True


# --- Sample side work (the Vault) -------------------------------------------------------

SIDE_WORK_SEEDED_KEY = "sample_side_work_seeded"
_RATE_CENTS = 4500  # 45.00 USD an hour, invented
_SESSIONS = ((1, 180), (3, 150), (4, 120))  # (days into the week, minutes)


def seed_side_work(conn: sqlite3.Connection, now: datetime) -> bool:
    """Add made-up side work, payments and exchange rates once. Sample database only.

    Dates are relative to now, so any day of the week shows the same mix: paid
    weeks (one paid short), an overdue week, waiting weeks, two bonuses, and an
    unscheduled client. Rates are invented for every day, so nothing goes online.
    """
    label = conn.execute("SELECT value FROM meta WHERE key = 'db_kind'").fetchone()
    if label is None or label[0] != DbKind.SAMPLE.value:
        raise DatabaseError("Sample side work only goes into the Sample database.")
    if conn.execute("SELECT 1 FROM meta WHERE key = ?", (SIDE_WORK_SEEDED_KEY,)).fetchone():
        return False

    today = now.astimezone().date()
    schedule = SAMPLE_PAY_SCHEDULES["sample_a"]
    week = pay_period(today, schedule)[0]  # this week's first day
    store = SideWorkStore(conn, clock=lambda: now)

    first_day = week - timedelta(weeks=7)
    stamp = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    rates = []
    for i in range((today - first_day).days + 1):
        rate = Decimal("1.3600") + Decimal("0.0015") * (i % 7)
        rates.append(((first_day + timedelta(days=i)).isoformat(), rate_text(rate), stamp))

    def add_rates() -> None:
        conn.executemany(
            "INSERT OR IGNORE INTO fx_rates (currency, day, rate, source, fetched_at) "
            "VALUES ('USD', ?, ?, 'boc', ?)",
            rates,
        )

    with_transaction(conn, add_rates)

    def log_week(start: date) -> list[int]:
        ids = []
        for offset, minutes in _SESSIONS:
            day = start + timedelta(days=offset)
            if day <= today:
                e = store.add_entry(
                    worked_on=day,
                    company="sample_a",
                    role="Evaluator",
                    minutes=minutes,
                    rate_cents=_RATE_CENTS,
                    currency="USD",
                )
                ids.append(e.id)
        return ids

    def pay(kind: str, received: date, cents: int, entry_ids: list[int]) -> None:
        found = rate_on(conn, received)
        store.record_payment(
            kind=kind,
            company="sample_a",
            received_on=received,
            amount_cents=cents,
            currency="USD",
            entry_ids=entry_ids,
            rate=found[0],
            rate_date=found[1],
        )

    # Six weeks back to three: paid (the five-weeks-back one paid 12.00 short).
    for weeks_back in (6, 5, 4):
        start = week - timedelta(weeks=weeks_back)
        ids = log_week(start)
        owed = sum(expected_cents(m, _RATE_CENTS) for _o, m in _SESSIONS)
        received = start + timedelta(days=6 + 9)
        pay("pay", received, owed - (1200 if weeks_back == 5 else 0), ids)
        if weeks_back != 6:
            pay("bonus", received + timedelta(days=1), 2500, [])
    # Three weeks back: never arrived (overdue). Two, one and this week: waiting or due.
    for weeks_back in (3, 2, 1, 0):
        log_week(week - timedelta(weeks=weeks_back))

    # A client with no pay schedule, paid in CAD.
    quill = [
        store.add_entry(
            worked_on=week - timedelta(weeks=w, days=2),
            company="Quill & Co",
            role="Technical writer",
            minutes=240,
            rate_cents=6000,
            currency="CAD",
        )
        for w in (4, 1)
    ]
    store.record_payment(
        kind="pay",
        company="Quill & Co",
        received_on=quill[0].worked_on + timedelta(days=10),
        amount_cents=24000,
        currency="CAD",
        entry_ids=[quill[0].id],
        rate=None,
        rate_date=None,
    )

    with_transaction(
        conn,
        lambda: conn.execute(
            "INSERT INTO meta (key, value) VALUES (?, '1')", (SIDE_WORK_SEEDED_KEY,)
        ),
    )
    return True


def _local_minute(moment: datetime) -> str:
    """Local Mac time to the minute, the format reminders use."""
    return moment.astimezone().strftime("%Y-%m-%dT%H:%M")


def _already_seeded(conn: sqlite3.Connection) -> bool:
    row = conn.execute("SELECT 1 FROM meta WHERE key = ?", (SEEDED_KEY,)).fetchone()
    return row is not None
