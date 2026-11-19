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

import hashlib
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from pathlib import Path

from aicity.checkin_reminder import CHECKIN_TITLE
from aicity.db import DatabaseError, DbKind, db_path, open_database, with_transaction
from aicity.fx import rate_on
from aicity.income import IncomeStore
from aicity.notifications import SINCE_KEY
from aicity.plan import PlanStore, monday_of
from aicity.settings import (
    BlockRule,
    IncomeSettings,
    MainJob,
    PaySchedule,
    PlanSettings,
    UsualEvent,
)
from aicity.side_work import SideWorkStore
from aicity.side_work_math import expected_cents, pay_period, rate_text, to_cad_cents
from aicity.tasks import TaskStore, utc_now

SEEDED_KEY = "sample_seeded"

# Sample mode's own side-work settings, so demos never show the private settings.
SAMPLE_PAY_SCHEDULES: dict[str, PaySchedule] = {
    "sample_a": PaySchedule("sample_a", "Nimbus Labs", 5, (5, 6), (3, 4), "NIMBUS LABS"),
}
SAMPLE_MAIN_JOB = MainJob(name="Day job", deposit_match="DAY JOB PAY")
SAMPLE_GOAL_CENTS = 650000
_WEEKDAYS = (0, 1, 2, 3, 4)
# Sample mode's Daily plan fixed blocks: made-up times, never the private settings.
SAMPLE_PLAN = PlanSettings(
    blocks=(
        BlockRule("Commute", "commute", (0, 1), time(8, 15), time(8, 45)),
        BlockRule("Work", "work", _WEEKDAYS, time(9), time(12)),
        BlockRule("Gym", "gym", _WEEKDAYS, time(12), time(13)),
        BlockRule("Work", "work", _WEEKDAYS, time(13), time(17)),
        BlockRule("Commute", "commute", (0, 1), time(17), time(17, 30)),
    ),
    # One-tap chips at the Sunday check-in: invented, like everything here.
    usual_events=(
        UsualEvent("Book club", "event", None, time(19), time(20, 30)),
        UsualEvent("Five-a-side", "event", 4, time(20), time(21)),
    ),
)

SAMPLE_INCOME = IncomeSettings(
    tax_set_aside_percent=Decimal(20), tax_set_aside_is_placeholder=True, statement_due_day=8
)


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
        seed_income(conn, now)
        seed_plan(conn, now)
        seed_checkin_notification(conn, now)
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


# --- Sample Daily plan (Mission Control) -----------------------------------------------

PLAN_SEEDED_KEY = "sample_plan_seeded"


def seed_plan(conn: sqlite3.Connection, now: datetime) -> bool:
    """Save this week's made-up plan with two invented evening events, once. Sample only.

    The events go on today and the next day (both today on a Sunday), so they're
    never on a past day and can be edited in a demo.
    """
    label = conn.execute("SELECT value FROM meta WHERE key = 'db_kind'").fetchone()
    if label is None or label[0] != DbKind.SAMPLE.value:
        raise DatabaseError("The sample plan only goes into the Sample database.")
    if conn.execute("SELECT 1 FROM meta WHERE key = ?", (PLAN_SEEDED_KEY,)).fetchone():
        return False

    today = now.astimezone().date()
    week_start = monday_of(today)
    next_day = min(today + timedelta(days=1), week_start + timedelta(days=6))
    store = PlanStore(conn, clock=lambda: now)

    def work() -> None:
        store.ensure_week(week_start, SAMPLE_PLAN, today)
        store.add_block(week_start, today, time(19), time(20, 30), "Book club", "event", today)
        store.add_block(
            week_start, next_day, time(20, 30), time(21, 30), "Five-a-side", "event", today
        )
        conn.execute("INSERT INTO meta (key, value) VALUES (?, '1')", (PLAN_SEEDED_KEY,))

    with_transaction(conn, work, immediate=True)
    return True


CHECKIN_SEEDED_KEY = "sample_checkin_seeded"


def seed_checkin_notification(conn: sqlite3.Connection, now: datetime) -> bool:
    """One ready-made check-in notification, once, so a demo shows the shuttle and ticker.

    Sample mode never makes real check-in reminders (the background check is Personal only).
    Its own once-only check, so a Sample database made before the check-in gets it too.
    """
    label = conn.execute("SELECT value FROM meta WHERE key = 'db_kind'").fetchone()
    if label is None or label[0] != DbKind.SAMPLE.value:
        raise DatabaseError("The sample check-in notification only goes into the Sample database.")
    if conn.execute("SELECT 1 FROM meta WHERE key = ?", (CHECKIN_SEEDED_KEY,)).fetchone():
        return False

    def work() -> None:
        conn.execute(
            "INSERT INTO notifications (kind, task_id, title, due_at, created_at) "
            "VALUES ('checkin', NULL, ?, ?, ?)",
            (
                CHECKIN_TITLE,
                _local_minute(now - timedelta(minutes=10)),
                now.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            ),
        )
        conn.execute("INSERT INTO meta (key, value) VALUES (?, '1')", (CHECKIN_SEEDED_KEY,))

    with_transaction(conn, work, immediate=True)
    return True


# --- Sample side work (the Vault) -------------------------------------------------------

SIDE_WORK_SEEDED_KEY = "sample_side_work_seeded"
_RATE_CENTS = 4500  # 45.00 USD an hour, invented
_SESSIONS = ((1, 300), (3, 250), (4, 200))  # (days into the week, hours x 100)


def sample_rate(day: date) -> Decimal:
    """Sample mode's invented USD-to-CAD rate for a day (it never goes online)."""
    return Decimal("1.3600") + Decimal("0.0015") * (day.toordinal() % 7)


def ensure_sample_rates(conn: sqlite3.Connection, first_day: date, last_day: date) -> None:
    """Invented USD-to-CAD rates for every day in the range that has none yet.

    Sample mode never goes online, so it makes its own: called at seeding and
    whenever Sample's Side work opens, so later days never show "rate pending".
    """
    stamp = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    rows = []
    for i in range((last_day - first_day).days + 1):
        day = first_day + timedelta(days=i)
        rows.append((day.isoformat(), rate_text(sample_rate(day)), stamp))
    with_transaction(
        conn,
        lambda: conn.executemany(
            "INSERT OR IGNORE INTO fx_rates (currency, day, rate, source, fetched_at) "
            "VALUES ('USD', ?, ?, 'boc', ?)",
            rows,
        ),
    )


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

    ensure_sample_rates(conn, week - timedelta(weeks=7), today)

    def log_week(start: date) -> list[int]:
        ids = []
        for offset, hundredths in _SESSIONS:
            day = start + timedelta(days=offset)
            if day <= today:
                e = store.add_entry(
                    worked_on=day,
                    company="sample_a",
                    role="Evaluator",
                    hundredths=hundredths,
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
            hundredths=400,
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


# --- Sample income (the Vault, part B) --------------------------------------------------

INCOME_SEEDED_KEY = "sample_income_seeded"
_PAY_NET, _PAY_GROSS, _PAY_RRSP, _PAY_MATCH = 245000, 340000, 17000, 8500  # invented
_PAYDAYS = 14  # about 6 months of biweekly pay


def _sample_key(text: str) -> str:
    return hashlib.sha256(f"sample:{text}".encode()).hexdigest()


def last_seeded_payday(today: date) -> date:
    """The newest main-job payday in the seeded history: a Friday at least 2 weeks back."""
    friday = today - timedelta(days=(today.weekday() - 4) % 7)
    return friday - timedelta(days=14)


def seed_income(conn: sqlite3.Connection, now: datetime) -> bool:
    """Made-up main-job pay (plus one typed in and not yet confirmed) and the deposits
    behind Sample's paid side work, once."""
    label = conn.execute("SELECT value FROM meta WHERE key = 'db_kind'").fetchone()
    if label is None or label[0] != DbKind.SAMPLE.value:
        raise DatabaseError("Sample income only goes into the Sample database.")
    if conn.execute("SELECT 1 FROM meta WHERE key = ?", (INCOME_SEEDED_KEY,)).fetchone():
        return False
    today = now.astimezone().date()
    side = SideWorkStore(conn, clock=lambda: now)
    income = IncomeStore(conn, clock=lambda: now)
    newest = last_seeded_payday(today)
    paydays = [newest - timedelta(days=14 * i) for i in range(_PAYDAYS)]
    payments = side.payments()
    first = min([*paydays, *(p.received_on for p in payments)])

    def work() -> None:
        imp = income.record_import(
            first_day=first, last_day=newest, kept=0, duplicates=0, skipped=0, spending=38
        )
        for i, day in enumerate(sorted(paydays)):
            d = income.add_deposit(
                posted_on=day,
                amount_cents=_PAY_NET,
                kind="main_job",
                source="main_job",
                row_key=_sample_key(f"pay-{day}"),
                import_id=imp,
            )
            stub = day != newest  # the newest stub isn't typed in yet
            income.add_main_job_pay(
                paid_on=day,
                net_cents=_PAY_NET,
                gross_cents=_PAY_GROSS if stub else None,
                rrsp_cents=_PAY_RRSP if stub else None,
                match_cents=_PAY_MATCH if stub else None,
                notes="Holiday pay included" if i == 3 else None,
                deposit_id=d.id,
            )
        # The next payday, typed in by hand and waiting for the statement ("not yet
        # confirmed"); the demo statement's deposit confirms it.
        income.add_main_job_pay(
            paid_on=newest + timedelta(days=14),
            net_cents=_PAY_NET,
            gross_cents=_PAY_GROSS,
            rrsp_cents=_PAY_RRSP,
            match_cents=_PAY_MATCH,
            notes=None,
        )
        for p in payments:
            cad = to_cad_cents(p.amount_cents, p.currency, p.rate)
            d = income.add_deposit(
                posted_on=p.received_on,
                amount_cents=cad,
                kind="side_work",
                source=p.company or "Other",
                row_key=_sample_key(f"side-{p.id}"),
                import_id=imp,
            )
            side.link_deposit(p.id, d.id, company=p.company)
        conn.execute(
            "UPDATE statement_imports SET kept = ? WHERE id = ?",
            (len(paydays) + len(payments), imp),
        )
        conn.execute("INSERT INTO meta (key, value) VALUES (?, '1')", (INCOME_SEEDED_KEY,))

    with_transaction(conn, work, immediate=True)
    return True


def build_sample_statement(conn: sqlite3.Connection, side: SideWorkStore, today: date) -> bytes:
    """A made-up chequing statement for demonstrating the import (never stored as a file).

    It holds the next main-job pay (a day early; it confirms the typed-in one), the pay and bonus for Sample's oldest overdue
    week, two purchases, a refund (other money in) and one USD row.
    """
    from aicity.statement_import import open_weeks  # avoids a circular import at load

    rows: list[tuple[date, str, str, int, str]] = []
    payday = last_seeded_payday(today) + timedelta(days=14)
    # Posted a day before payday, as banks do, to show the link keeps the typed date.
    rows.append((payday - timedelta(days=1), "Deposit", "DAY JOB PAY", _PAY_NET, "CAD"))
    due = [w for w in open_weeks(side, SAMPLE_PAY_SCHEDULES) if w.window[0] <= today]
    if due:
        week = due[0]
        day = week.window[0]
        found = rate_on(conn, day)  # read only: a GET must never write
        rate = found[0] if found else sample_rate(day)
        expected = sum(
            to_cad_cents(c, cur, rate) or 0 for cur, c in week.expected_by_currency.items()
        )
        rows.append((day, "Deposit", "NIMBUS LABS PAYOUT", expected - expected // 125, "CAD"))
        rows.append(
            (min(day + timedelta(days=1), today), "Deposit", "NIMBUS LABS BONUS", 2500, "CAD")
        )
    rows.append((today - timedelta(days=6), "Purchase", "CORNER GROCER", -6420, "CAD"))
    rows.append((today - timedelta(days=3), "Purchase", "TRANSIT PASS", -15600, "CAD"))
    rows.append((today - timedelta(days=4), "Deposit", "STORE REFUND", 1500, "CAD"))
    rows.append((today - timedelta(days=2), "Deposit", "NIMBUS LABS", 1000, "USD"))
    rows.sort(key=lambda r: r[0])

    lines = ["date,transaction,description,amount,balance,currency"]
    for day, kind, text, cents, currency in rows:
        # Each row's balance depends only on that row, so the same made-up row is
        # identical every time (like re-downloading a real statement) and a second
        # try is recognised as already imported.
        balance = 400_000 + (day.toordinal() * 37 + abs(cents)) % 300_000
        amount = f"{cents / 100:.2f}"
        lines.append(f"{day.isoformat()},{kind},{text},{amount},{balance / 100:.2f},{currency}")
    return ("\n".join(lines) + "\n").encode()


def _local_minute(moment: datetime) -> str:
    """Local Mac time to the minute, the format reminders use."""
    return moment.astimezone().strftime("%Y-%m-%dT%H:%M")


def _already_seeded(conn: sqlite3.Connection) -> bool:
    row = conn.execute("SELECT 1 FROM meta WHERE key = ?", (SEEDED_KEY,)).fetchone()
    return row is not None
