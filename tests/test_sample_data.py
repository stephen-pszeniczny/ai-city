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
from aicity.sample_data import (
    SAMPLE_TASKS,
    last_seeded_payday,
    reset_sample_database,
    seed,
    seed_sample_database,
)
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
        assert store.check_reminders() == 1  # only the demo task reminder fires
        active = sorted((n.kind, n.title) for n in store.list_active())
        # The check-in notification is seeded ready-made, alongside it.
        assert active == [
            ("checkin", "Time for your Sunday check-in"),
            ("reminder", "Water the balcony plants"),
        ]
    finally:
        conn.close()


# --- Sample side work (the Vault) ------------------------------------------------------


def sample_view(now=NOW):
    from aicity.sample_data import SAMPLE_INCOME, SAMPLE_PAY_SCHEDULES
    from aicity.side_work import SideWorkStore, side_work_view

    conn = open_database(db_path(DbKind.SAMPLE), DbKind.SAMPLE)
    try:
        store = SideWorkStore(conn, clock=lambda: now)
        today = now.astimezone().date()
        return side_work_view(store, conn, SAMPLE_PAY_SCHEDULES, SAMPLE_INCOME, today)
    finally:
        conn.close()


@pytest.mark.parametrize("days_later", [0, 1, 2, 3, 4, 5, 6])
def test_sample_side_work_has_what_a_demo_needs(days_later):
    now = NOW + timedelta(days=days_later)  # any weekday gives the same mix
    seed_sample_database(clock=lambda: now)
    v = sample_view(now)
    statuses = Counter(g["status"] for g in v["groups"])
    assert {"paid", "waiting", "overdue", "no_schedule"} <= set(statuses)
    assert any((g["difference_cad_cents"] or 0) < 0 for g in v["groups"])  # one paid short
    assert len(v["bonuses"]) == 2
    assert v["summary"]["rates_pending"] is False
    assert v["summary"]["month_received_cad_cents"] > 0 or now.day < 10


def test_sample_side_work_is_seeded_once():
    seed_sample_database(clock=lambda: NOW)
    first = sample_view()
    seed_sample_database(clock=lambda: NOW)
    assert sample_view() == first


def test_an_older_sample_database_gets_side_work_too():
    conn = open_database(db_path(DbKind.SAMPLE), DbKind.SAMPLE)
    try:
        seed(conn, NOW)  # tasks only, as before the Vault existed
    finally:
        conn.close()
    seed_sample_database(clock=lambda: NOW)
    assert sample_view()["groups"]


def test_sample_side_work_uses_only_invented_names():
    seed_sample_database(clock=lambda: NOW)
    names = {g["company_name"] for g in sample_view()["groups"]}
    assert names <= {"Nimbus Labs", "Quill & Co"}


# --- Sample income (the Vault, part B) ---------------------------------------------------


def income_view_now(now=NOW):
    from aicity.income import IncomeStore
    from aicity.income_view import income_view
    from aicity.sample_data import SAMPLE_GOAL_CENTS, SAMPLE_INCOME, SAMPLE_PAY_SCHEDULES
    from aicity.side_work import SideWorkStore

    conn = open_database(db_path(DbKind.SAMPLE), DbKind.SAMPLE)
    try:
        return income_view(
            conn,
            SideWorkStore(conn, clock=lambda: now),
            IncomeStore(conn, clock=lambda: now),
            SAMPLE_GOAL_CENTS,
            SAMPLE_INCOME,
            SAMPLE_PAY_SCHEDULES,
            "Day job",
            now.astimezone().date(),
        )
    finally:
        conn.close()


@pytest.mark.parametrize("days_later", [0, 3, 9, 16])
def test_sample_income_fills_the_charts(days_later):
    now = NOW + timedelta(days=days_later)
    seed_sample_database(clock=lambda: now)
    v = income_view_now(now)
    assert len(v["months"]) == 6
    assert all(m["total_cents"] > 0 for m in v["months"][:-1])  # this month may be empty yet
    assert any(r["gross_cents"] is None for r in v["main_job_pay"])  # one stub not typed in
    assert any(r["gross_cents"] is not None for r in v["main_job_pay"])
    assert v["platforms"] and v["platforms"][0]["rate_cad_cents"]


def test_sample_paid_weeks_are_proven_by_deposits():
    seed_sample_database(clock=lambda: NOW)
    conn = open_database(db_path(DbKind.SAMPLE), DbKind.SAMPLE)
    try:
        unlinked = conn.execute(
            "SELECT count(*) FROM side_work_payments WHERE deposit_id IS NULL"
        ).fetchone()[0]
    finally:
        conn.close()
    assert unlinked == 0


def test_an_older_sample_database_gets_income_too():
    conn = open_database(db_path(DbKind.SAMPLE), DbKind.SAMPLE)
    try:
        seed(conn, NOW)  # tasks only, as before the Vault existed
    finally:
        conn.close()
    seed_sample_database(clock=lambda: NOW)
    assert income_view_now()["main_job_pay"]


def test_sample_income_is_seeded_once():
    seed_sample_database(clock=lambda: NOW)
    first = income_view_now()
    seed_sample_database(clock=lambda: NOW)
    assert income_view_now() == first


def test_sample_has_one_unconfirmed_typed_pay():
    seed_sample_database(clock=lambda: NOW)
    today = NOW.astimezone().date()
    waiting = [r for r in income_view_now()["main_job_pay"] if not r["confirmed"]]
    assert [r["day"] for r in waiting] == [
        (last_seeded_payday(today) + timedelta(days=14)).isoformat()
    ]


# --- Sample Daily plan ----------------------------------------------------------


def sample_week(now: datetime = NOW):
    from aicity.plan import PlanStore, monday_of

    conn = open_database(db_path(DbKind.SAMPLE), DbKind.SAMPLE)
    return PlanStore(conn, clock=lambda: now).get_week(monday_of(now.astimezone().date()))


def test_sample_plan_has_made_up_blocks():
    from aicity.sample_data import SAMPLE_PLAN

    kinds = {rule.kind for rule in SAMPLE_PLAN.blocks}
    assert {"work", "gym", "commute"} <= kinds


@pytest.mark.parametrize("days_later", [0, 3, 5])  # Tuesday, Friday, Sunday
def test_sample_plan_seeds_this_week_with_two_events(days_later):
    now = NOW + timedelta(days=days_later)
    seed_sample_database(clock=lambda: now)
    week = sample_week(now)
    today = now.astimezone().date().isoformat()
    events = [b for _, blocks in week.days for b in blocks if b.kind == "event"]
    assert [e.title for e in events] == ["Book club", "Five-a-side"]
    assert all(e.day >= today for e in events)  # still editable
    assert any(b.kind == "gym" for _, blocks in week.days for b in blocks)


def test_sample_plan_is_seeded_once():
    from aicity.sample_data import seed_plan

    seed_sample_database(clock=lambda: NOW)
    conn = open_database(db_path(DbKind.SAMPLE), DbKind.SAMPLE)
    assert seed_plan(conn, NOW) is False
    week = sample_week()
    assert sum(b.kind == "event" for _, blocks in week.days for b in blocks) == 2


def test_seed_plan_refuses_the_personal_database():
    from aicity.sample_data import seed_plan

    conn = open_database(db_path(DbKind.PERSONAL), DbKind.PERSONAL)
    with pytest.raises(DatabaseError):
        seed_plan(conn, NOW)


def test_sample_has_one_checkin_notification():
    from aicity.checkin_reminder import CHECKIN_TITLE

    seed_sample_database(clock=lambda: NOW)
    seed_sample_database(clock=lambda: NOW)
    conn = open_database(db_path(DbKind.SAMPLE), DbKind.SAMPLE)
    rows = conn.execute(
        "SELECT title FROM notifications WHERE kind = 'checkin' "
        "AND dismissed_at IS NULL AND cleared_at IS NULL"
    ).fetchall()
    assert rows == [(CHECKIN_TITLE,)]


def test_sample_plan_has_usual_events():
    from aicity.sample_data import SAMPLE_PLAN

    assert [e.title for e in SAMPLE_PLAN.usual_events] == ["Book club", "Five-a-side"]


def test_sample_routines_are_made_up():
    from aicity.sample_data import SAMPLE_ROUTINES

    [routine] = SAMPLE_ROUTINES
    assert (routine.id, routine.title) == ("evening_prep", "Evening prep")
    assert 6 in routine.days  # Sunday
    assert routine.items == ("Lunch packed", "Water bottle filled", "Bag by the door")
