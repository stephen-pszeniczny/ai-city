"""Belt XP: the level curve, and XP worked out from what the database already records.

Everything here is made up. Temporary Sample-labelled databases only. Times are 15:00 UTC
unless a test is about local days, so the Toronto date matches the UTC one.
"""

import re
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from aicity import jobs_store, xp_rules
from aicity.db import DbKind, load_migrations, open_database
from aicity.jobs_settings import DEFAULT_CHECK_DAYS, JobPlatform, JobsSettings
from aicity.jobs_store import JobsConflict, JobsStore
from aicity.routines import RoutineStore
from aicity.settings import BUILDING_IDS, Routine
from aicity.tasks import TaskStore
from aicity.xp import (
    BuildingXp,
    XpError,
    XpStore,
    backfill_routine_finishes,
    belt_view,
    building_view,
    building_xp,
)
from aicity.xp_rules import NORMAL_YEAR_XP, level_for_xp, xp_for_level

TZ = ZoneInfo("America/Toronto")
NOW = datetime(2026, 11, 29, 15, 0, tzinfo=UTC)  # a Sunday
SUNDAY = date(2026, 11, 29)
STAMP = "2026-11-29T15:00:00Z"
PREP = Routine("evening_prep", "Evening prep", (6, 0), time(19), None, ("Lunch", "Bag"))
ROUTINES = (PREP,)
JOBS = JobsSettings(
    pay_floor_usd=Decimal(30),
    pay_preferred_usd=Decimal(40),
    master_resume_label="v2",
    check_days=dict(DEFAULT_CHECK_DAYS),
    platforms=(JobPlatform("platform_a", "Platform A", "https://example.com/a", "active"),),
)


class Clock:
    def __init__(self, now: datetime = NOW) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now


@pytest.fixture
def conn(tmp_path):
    c = open_database(tmp_path / "sample.db", DbKind.SAMPLE)
    yield c
    c.close()


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def tasks(conn, clock):
    return TaskStore(conn, stale_after_days=7, clock=clock)


@pytest.fixture
def jobs(conn, clock):
    return JobsStore(conn, JOBS, clock=clock)


def xp(conn, building="planner"):
    return building_xp(conn, building, ROUTINES, TZ)


def done_task(tasks, title="Water the plants"):
    task = tasks.create(title=title, category="personal")
    tasks.complete(task.id)
    return task.id


def tick(conn, clock, item, ticked=True, routines=ROUTINES):
    RoutineStore(conn, clock=clock).set_tick(routines, "evening_prep", item, ticked, SUNDAY, SUNDAY)


# --- The level curve --------------------------------------------------------------------


def test_curve_endpoints():
    assert xp_for_level("planner", 1) == 0
    assert level_for_xp("planner", 0) == 1
    assert level_for_xp("planner", 10**9) == 100
    assert level_for_xp("planner", xp_for_level("planner", 37)) == 37
    assert level_for_xp("planner", xp_for_level("planner", 37) - 1) == 36


def test_normal_pace_hits_targets():
    for b in NORMAL_YEAR_XP:
        per_day = NORMAL_YEAR_XP[b] / 365
        day_lv10 = next(d for d in range(1, 800) if level_for_xp(b, int(per_day * d)) >= 10)
        day_lv100 = next(d for d in range(1, 800) if level_for_xp(b, int(per_day * d)) >= 100)
        assert 14 <= day_lv10 <= 21
        assert 330 <= day_lv100 <= 400


# --- Mission Control --------------------------------------------------------------------


def test_todo_xp_and_daily_cap(conn, tasks, clock):
    done_task(tasks)
    assert xp(conn) == 10
    for _ in range(6):
        done_task(tasks)
    assert xp(conn) == 50
    clock.now = NOW + timedelta(days=1)
    done_task(tasks)
    assert xp(conn) == 60


def test_cap_uses_local_day(conn, tasks, clock):
    for _ in range(5):
        done_task(tasks)
    # 23:30 in Toronto on the 29th is already the 30th in UTC: still the capped day.
    clock.now = datetime(2026, 11, 29, 23, 30, tzinfo=TZ)
    done_task(tasks)
    assert xp(conn) == 50
    # Half an hour later it's the 30th in Toronto too.
    clock.now = datetime(2026, 11, 30, 0, 0, tzinfo=TZ)
    done_task(tasks)
    assert xp(conn) == 60


def test_reopened_todo_earns_nothing(conn, tasks):
    task_id = done_task(tasks)
    tasks.reopen(task_id)
    assert xp(conn) == 0
    tasks.complete(task_id)  # done again: earns once, not twice
    assert xp(conn) == 10


def test_archiving_a_done_todo_keeps_its_xp(conn, tasks):
    tasks.archive(done_task(tasks))
    assert xp(conn) == 10


def test_reopen_after_archive_earns_nothing(conn, tasks):
    task_id = done_task(tasks)
    tasks.archive(task_id)
    tasks.reopen(task_id)
    assert xp(conn) == 0


def test_gym_done_15_skipped_0(conn):
    conn.execute(
        "INSERT INTO plan_weeks (id, week_start, created_at) VALUES (1, '2026-11-23', ?)", (STAMP,)
    )
    for status in ("done", "done", "skipped", "planned"):
        conn.execute(
            "INSERT INTO plan_blocks (week_id, day, start_time, end_time, title, kind, source, "
            "status, created_at, updated_at) "
            "VALUES (1, '2026-11-24', '11:45', '13:00', 'Gym', 'gym', 'added', ?, ?, ?)",
            (status, STAMP, STAMP),
        )
    assert xp(conn) == 30


def test_checkin_40_once_per_week(conn):
    conn.execute(
        "INSERT INTO plan_weeks (week_start, created_at, checked_in_at) "
        "VALUES ('2026-11-23', ?, ?)",
        (STAMP, STAMP),
    )
    conn.execute(
        "INSERT INTO plan_weeks (week_start, created_at) VALUES ('2026-11-30', ?)", (STAMP,)
    )
    assert xp(conn) == 40
    # Checking in again re-stamps the same week's row.
    conn.execute(
        "UPDATE plan_weeks SET checked_in_at = ? WHERE week_start = '2026-11-23'", (STAMP,)
    )
    assert xp(conn) == 40


# --- Routines ---------------------------------------------------------------------------


def finishes(conn):
    return conn.execute("SELECT day, routine_id FROM routine_finishes ORDER BY day").fetchall()


def test_routine_counts_only_when_fully_ticked(conn, clock):
    tick(conn, clock, "Lunch")
    assert xp(conn) == 0
    tick(conn, clock, "Bag")
    assert xp(conn) == 5
    tick(conn, clock, "Bag")  # ticking twice changes nothing
    assert xp(conn) == 5
    tick(conn, clock, "Bag", ticked=False)
    assert xp(conn) == 0
    assert finishes(conn) == []


def test_adding_a_routine_item_keeps_past_xp(conn, clock):
    tick(conn, clock, "Lunch")
    tick(conn, clock, "Bag")
    longer = (Routine(**{**PREP.__dict__, "items": ("Lunch", "Bag", "Keys")}),)
    assert building_xp(conn, "planner", longer, TZ) == 5
    backfill_routine_finishes(conn, longer, clock)
    assert building_xp(conn, "planner", longer, TZ) == 5


def test_ticking_never_removes_a_finish(conn, clock):
    tick(conn, clock, "Lunch")
    tick(conn, clock, "Bag")
    longer = (Routine(**{**PREP.__dict__, "items": ("Lunch", "Bag", "Keys", "Wallet")}),)
    tick(conn, clock, "Keys", routines=longer)  # "Wallet" is still unticked
    assert xp(conn) == 5
    tick(conn, clock, "Bag", routines=longer)  # already ticked
    assert xp(conn) == 5
    tick(conn, clock, "Wallet", ticked=False, routines=longer)  # wasn't ticked: no change
    assert xp(conn) == 5
    tick(conn, clock, "Lunch", ticked=False, routines=longer)  # a real correction
    assert xp(conn) == 0


def test_a_removed_item_does_not_count_towards_a_finish(conn, clock):
    tick(conn, clock, "Bag")
    swapped = (Routine(**{**PREP.__dict__, "items": ("Lunch", "Keys")}),)
    tick(conn, clock, "Lunch", routines=swapped)  # two ticks, but "Bag" is no longer an item
    assert finishes(conn) == []


def test_routine_backfill_runs_once(conn, clock):
    def raw_tick(day, item):
        conn.execute(
            "INSERT INTO routine_ticks (day, routine_id, item, ticked_at) "
            "VALUES (?, 'evening_prep', ?, ?)",
            (day, item, STAMP),
        )

    raw_tick("2026-11-22", "Lunch")
    raw_tick("2026-11-22", "Bag")
    raw_tick("2026-11-23", "Lunch")  # partial
    raw_tick("2026-11-23", "Old item")
    assert xp(conn) == 0  # reading XP never writes
    backfill_routine_finishes(conn, ROUTINES, clock)
    assert finishes(conn) == [("2026-11-22", "evening_prep")]
    raw_tick("2026-11-23", "Bag")
    backfill_routine_finishes(conn, ROUTINES, clock)
    assert finishes(conn) == [("2026-11-22", "evening_prep")]
    assert xp(conn) == 5


def test_backfill_with_no_routines_does_not_use_up_the_run(conn, clock):
    for item in PREP.items:
        conn.execute(
            "INSERT INTO routine_ticks (day, routine_id, item, ticked_at) "
            "VALUES ('2026-11-22', 'evening_prep', ?, ?)",
            (item, STAMP),
        )
    backfill_routine_finishes(conn, (), clock)
    backfill_routine_finishes(conn, ROUTINES, clock)
    assert finishes(conn) == [("2026-11-22", "evening_prep")]


# --- The Vault --------------------------------------------------------------------------


def test_a_finished_backfill_takes_no_write_lock(conn, clock, tmp_path):
    backfill_routine_finishes(conn, ROUTINES, clock)
    conn.execute("PRAGMA busy_timeout = 0")  # fail at once rather than wait
    writer = open_database(tmp_path / "sample.db", DbKind.SAMPLE)
    try:
        writer.execute("BEGIN IMMEDIATE")
        backfill_routine_finishes(conn, ROUTINES, clock)
        writer.execute("ROLLBACK")
    finally:
        writer.close()


def add_deposit(conn, deposit_id, kind="main_job"):
    conn.execute(
        "INSERT OR IGNORE INTO statement_imports (id, first_day, last_day, kept, duplicates, "
        "skipped, spending, created_at) VALUES (1, '2026-11-01', '2026-11-30', 1, 0, 0, 0, ?)",
        (STAMP,),
    )
    conn.execute(
        "INSERT INTO deposits (id, posted_on, amount_cents, kind, source, row_key, import_id, "
        "created_at) VALUES (?, '2026-11-13', 100, ?, 'example', ?, 1, ?)",
        (deposit_id, kind, f"{deposit_id:064d}", STAMP),
    )


def add_pay(conn, **columns):
    row = {"paid_on": "2026-11-13", "net_cents": 100, "created_at": STAMP, **columns}
    conn.execute(
        f"INSERT INTO main_job_payments ({', '.join(row)}) VALUES ({', '.join('?' * len(row))})",
        tuple(row.values()),
    )


def test_vault_events(conn):
    for archived in (0, 0, 1):
        conn.execute(
            "INSERT INTO side_work_entries (worked_on, currency, archived, created_at, "
            "updated_at) VALUES ('2026-11-10', 'CAD', ?, ?, ?)",
            (archived, STAMP, STAMP),
        )
    assert xp(conn, "finance") == 20

    # Two imports ending in November count once; December's counts again.
    for import_id, last_day in ((1, "2026-11-30"), (2, "2026-11-29"), (3, "2026-12-31")):
        conn.execute(
            "INSERT INTO statement_imports (id, first_day, last_day, kept, duplicates, skipped, "
            "spending, created_at) VALUES (?, '2026-11-01', ?, 1, 0, 0, 0, ?)",
            (import_id, last_day, STAMP),
        )
    assert xp(conn, "finance") == 20 + 80

    add_pay(conn)  # typed, not yet confirmed
    assert xp(conn, "finance") == 100
    add_deposit(conn, 1)
    add_pay(conn, deposit_id=1)
    add_pay(conn, hand_checked_at=STAMP)
    assert xp(conn, "finance") == 100 + 30

    add_deposit(conn, 2, "side_work")
    for deposit_id in (2, None):
        conn.execute(
            "INSERT INTO side_work_payments (kind, received_on, amount_cents, currency, "
            "deposit_id, created_at) VALUES ('pay', '2026-11-13', 100, 'CAD', ?, ?)",
            (deposit_id, STAMP),
        )
    assert xp(conn, "finance") == 130 + 15


def test_removed_pay_earns_nothing(conn):
    add_pay(conn, hand_checked_at=STAMP)
    assert xp(conn, "finance") == 15
    conn.execute("UPDATE main_job_payments SET archived_at = ?", (STAMP,))
    assert xp(conn, "finance") == 0


# --- Opportunity Office -----------------------------------------------------------------


def project(jobs, title="Example project"):
    return jobs.add_project(
        platform_id="platform_a", title=title, pay_cents=None, currency=None, hours_per_week=None
    )


def events(conn):
    return conn.execute(
        "SELECT project_id, status, at FROM job_project_events ORDER BY id"
    ).fetchall()


def test_project_changes_are_recorded_as_events(conn, jobs, clock):
    made = project(jobs)
    clock.now = NOW + timedelta(hours=1)
    jobs.set_project_status(made.id, "applied")
    jobs.edit_project(made.id, title="Renamed example")
    assert events(conn) == [
        (made.id, "found", STAMP),
        (made.id, "applied", "2026-11-29T16:00:00Z"),
    ]


def test_a_refused_project_change_records_no_event(conn, jobs):
    made = project(jobs)
    jobs.set_project_status(made.id, "rejected")
    with pytest.raises(JobsConflict, match="can't move"):
        jobs.set_project_status(made.id, "active")
    assert [e[1] for e in events(conn)] == ["found", "rejected"]


def test_a_move_is_checked_against_the_status_at_write_time(conn, jobs, monkeypatch):
    made = project(jobs)
    real = jobs_store.with_transaction

    def rival_moves_first(c, work, **kwargs):
        monkeypatch.setattr(jobs_store, "with_transaction", real)
        jobs.set_project_status(made.id, "rejected")
        return real(c, work, **kwargs)

    monkeypatch.setattr(jobs_store, "with_transaction", rival_moves_first)
    with pytest.raises(JobsConflict, match="rejected can't move to active"):
        jobs.set_project_status(made.id, "active")
    assert [e[1] for e in events(conn)] == ["found", "rejected"]
    assert jobs.projects()[0].status == "rejected"


def test_jobs_events(conn, jobs, clock):
    for _ in range(4):
        jobs.record_check("platform_a", "nothing")
    assert xp(conn, "jobs") == 30
    clock.now = NOW + timedelta(days=1)
    jobs.record_check("platform_a", "found")
    assert xp(conn, "jobs") == 40

    made = project(jobs)
    assert xp(conn, "jobs") == 55
    jobs.set_project_status(made.id, "assessment")  # skipping "applied": two stages reached
    assert xp(conn, "jobs") == 55 + 40
    jobs.set_project_status(made.id, "accepted")
    jobs.set_project_status(made.id, "active")
    jobs.set_project_status(made.id, "ended")
    assert xp(conn, "jobs") == 55 + 100

    conn.execute(
        "INSERT INTO platform_profile_refreshes (platform_id, refreshed_on, created_at) "
        "VALUES ('platform_a', '2026-11-29', ?)",
        (STAMP,),
    )
    assert xp(conn, "jobs") == 155 + 20


def add_refresh(conn, platform_id, created_at):
    conn.execute(
        "INSERT INTO platform_profile_refreshes (platform_id, refreshed_on, created_at) "
        "VALUES (?, '2026-11-01', ?)",
        (platform_id, created_at),
    )


def test_profile_refresh_counts_once_per_platform_per_month(conn):
    # A typo fix and a toggle back in the same month earn nothing more.
    for created_at in ("2026-11-02T15:00:00Z", "2026-11-02T15:01:00Z", "2026-11-28T15:00:00Z"):
        add_refresh(conn, "platform_a", created_at)
    assert xp(conn, "jobs") == 20
    add_refresh(conn, "platform_b", "2026-11-28T15:00:00Z")  # another platform
    assert xp(conn, "jobs") == 40
    add_refresh(conn, "platform_a", "2026-12-15T15:00:00Z")  # the next month
    assert xp(conn, "jobs") == 60
    add_refresh(conn, "platform_a", "2027-11-15T15:00:00Z")  # the same month a year on
    assert xp(conn, "jobs") == 80


def test_profile_refresh_month_is_local(conn):
    add_refresh(conn, "platform_a", "2026-11-15T15:00:00Z")
    # Already December in UTC, still 23:30 on 30 November in Toronto.
    add_refresh(conn, "platform_a", "2026-12-01T04:30:00Z")
    assert xp(conn, "jobs") == 20
    add_refresh(conn, "platform_a", "2026-12-01T05:00:00Z")  # midnight in Toronto
    assert xp(conn, "jobs") == 40


def test_rejected_project_keeps_stages_reached(conn, jobs):
    made = project(jobs)
    jobs.set_project_status(made.id, "accepted")
    jobs.set_project_status(made.id, "rejected")
    assert xp(conn, "jobs") == 15 + 3 * 20


def test_a_project_known_only_as_rejected_counts_one_stage(conn):
    conn.execute(
        "INSERT INTO job_projects (id, platform_id, title, status, found_on, status_at) "
        "VALUES (1, 'platform_a', 'Example', 'rejected', '2026-11-01', ?)",
        (STAMP,),
    )
    conn.execute(
        "INSERT INTO job_project_events (project_id, status, at) VALUES (1, 'rejected', ?)",
        (STAMP,),
    )
    assert xp(conn, "jobs") == 15 + 20


# --- Flight School ----------------------------------------------------------------------


def test_career_events(conn, monkeypatch):
    # Flight School is switched off until its screens ship; switch it on to check its rules.
    monkeypatch.setattr(xp_rules, "EARNING_BUILDINGS", xp_rules.EARNING_BUILDINGS | {"career"})
    for month, status in (("2026-09", "done"), ("2026-10", "done"), ("2026-11", "proposed")):
        conn.execute(
            "INSERT INTO fs_months (month, status, updated_at) VALUES (?, ?, ?)",
            (month, status, STAMP),
        )
    assert xp(conn, "career") == 120
    for status in ("ready", "draft"):
        conn.execute(
            "INSERT INTO fs_examples (competency_id, situation, action, outcome, status, "
            "updated_at) VALUES ('1.1', 's', 'a', 'o', ?, ?)",
            (status, STAMP),
        )
    assert xp(conn, "career") == 145
    # Minutes add up per day before rounding down: 3 + 4 = 7 gives 1; 400 is capped at 60 (12).
    for day, minutes in (("2026-11-01", 3), ("2026-11-01", 4), ("2026-11-02", 400)):
        conn.execute(
            "INSERT INTO fs_study (day, minutes, created_at) VALUES (?, ?, ?)",
            (day, minutes, STAMP),
        )
    assert xp(conn, "career") == 145 + 1 + 12


def test_unbuilt_or_disabled_building_earns_zero(conn):
    conn.execute(
        "INSERT INTO fs_months (month, status, updated_at) VALUES ('2026-10', 'done', ?)", (STAMP,)
    )
    assert "career" not in xp_rules.EARNING_BUILDINGS
    assert xp(conn, "career") == 0
    assert xp(conn, "training") == 0


# --- Seen and celebrated ----------------------------------------------------------------


def view(conn, building="planner"):
    return building_view(conn, building, ROUTINES, TZ)


def test_seen_is_zero_when_absent(conn, clock):
    assert XpStore(conn, clock).seen("planner") == (0, 0)


def test_mark_seen_never_lowers(conn, clock):
    store = XpStore(conn, clock)
    store.mark_seen("belt", 7)
    store.mark_seen("belt", 3)
    assert store.seen("belt") == (7, 0)
    store.mark_seen("belt", 9)
    assert store.seen("belt") == (9, 0)
    assert store.seen("planner") == (0, 0)


def test_celebrated_never_lowers_and_keeps_seen(conn, clock):
    store = XpStore(conn, clock)
    store.mark_celebrated("planner", 2, current_tier=3)
    assert store.seen("planner") == (0, 2)
    store.mark_seen("planner", 25)
    store.mark_celebrated("planner", 1, current_tier=3)
    assert store.seen("planner") == (25, 2)
    store.mark_celebrated("planner", 3, current_tier=3)
    assert store.seen("planner") == (25, 3)


def test_celebrated_cannot_exceed_tier(conn, clock):
    store = XpStore(conn, clock)
    with pytest.raises(XpError, match="tier"):
        store.mark_celebrated("planner", 2, current_tier=1)
    assert conn.execute("SELECT count(*) FROM xp_seen").fetchone()[0] == 0


# --- Building and belt views ------------------------------------------------------------


def test_building_view_of_a_new_database(conn):
    assert view(conn) == BuildingXp(
        id="planner",
        earning=True,
        xp=0,
        level=1,
        level_start_xp=0,
        next_level_xp=xp_for_level("planner", 2),
        tier=0,
        seen_level=0,
        celebrated_tier=0,
        upgrade_waiting=False,
    )


@pytest.mark.parametrize("building", ["career", "gym"])
def test_building_view_of_a_building_not_earning_is_all_zeros(conn, building):
    assert view(conn, building) == BuildingXp(
        id=building,
        earning=False,
        xp=0,
        level=0,
        level_start_xp=0,
        next_level_xp=0,
        tier=0,
        seen_level=0,
        celebrated_tier=0,
        upgrade_waiting=False,
    )


def test_head_start_is_added_before_level_and_tier(conn, clock):
    add_gym_done(conn, 2)
    head_start = xp_for_level("planner", 30) - 30
    ahead = building_view(conn, "planner", ROUTINES, TZ, head_start=head_start)
    assert (ahead.xp, ahead.level, ahead.tier) == (xp_for_level("planner", 30), 30, 3)
    assert ahead.upgrade_waiting is True
    # A celebrated upgrade still holds the level up over the head start.
    XpStore(conn, clock).mark_celebrated("planner", 5, current_tier=5)
    held = building_view(conn, "planner", ROUTINES, TZ, head_start=head_start)
    assert (held.level, held.tier) == (50, 5)
    # A building not earning yet gets none of it.
    assert building_view(conn, "career", ROUTINES, TZ, head_start=500).xp == 0


def add_gym_done(conn, count):
    conn.execute(
        "INSERT INTO plan_weeks (id, week_start, created_at) VALUES (1, '2026-11-23', ?)", (STAMP,)
    )
    conn.executemany(
        "INSERT INTO plan_blocks (week_id, day, start_time, end_time, title, kind, source, "
        "status, created_at, updated_at) "
        "VALUES (1, '2026-11-24', '11:45', '13:00', 'Gym', 'gym', 'added', 'done', ?, ?)",
        [(STAMP, STAMP)] * count,
    )


def test_building_view_at_the_top_level(conn):
    add_gym_done(conn, NORMAL_YEAR_XP["planner"] // xp_rules.GYM_XP + 1)
    top = view(conn)
    assert (top.level, top.tier) == (100, 10)
    assert top.level_start_xp == top.next_level_xp == xp_for_level("planner", 100)


def test_undo_lowers_xp_but_not_below_celebrated(conn, tasks, clock):
    level_20, level_15 = xp_for_level("planner", 20), xp_for_level("planner", 15)
    # Gym blocks make up the bulk; to-dos, five a day, take it over level 20.
    add_gym_done(conn, (level_15 - 100) // xp_rules.GYM_XP)
    done = []
    while xp(conn) < level_20:
        clock.now = NOW + timedelta(days=len(done) // xp_rules.TODOS_PER_DAY)
        done.append(done_task(tasks))
    before = view(conn)
    assert (before.level, before.tier, before.upgrade_waiting) == (20, 2, True)

    store = XpStore(conn, clock)
    store.mark_celebrated("planner", 2, current_tier=before.tier)
    store.mark_seen("planner", before.level)
    while level_for_xp("planner", xp(conn)) > 15:
        tasks.reopen(done.pop())

    after = view(conn)
    assert level_for_xp("planner", after.xp) == 15
    assert level_15 <= after.xp < before.xp
    assert (after.level, after.tier, after.upgrade_waiting) == (20, 2, False)
    assert (after.level_start_xp, after.next_level_xp) == (level_20, xp_for_level("planner", 21))
    assert (after.seen_level, after.celebrated_tier) == (20, 2)


def made_view(building, level, total=0, earning=True):
    return BuildingXp(building, earning, total, level, 0, 0, level // 10, 0, 0, False)


@pytest.mark.parametrize(
    ("levels", "level", "progress"),
    [
        ((100, 100, 100), 33, 3 / 9),
        ((1, 1, 1), 1, 3 / 18),
        ((9,), 1, 0.5),
        ((17,), 1, 17 / 18),
        ((18,), 2, 0.0),
        ((20,), 2, 2 / 9),
        ((100,) * 9, 100, 1.0),
        ((), 1, 0.0),
    ],
)
def test_belt_level_sum_div_9(levels, level, progress):
    buildings = [made_view(BUILDING_IDS[i], lv) for i, lv in enumerate(levels)]
    belt = belt_view(buildings, BUILDING_IDS, seen_level=0)
    assert belt.level == level
    assert belt.progress == pytest.approx(progress)


def test_belt_totals_xp_of_earning_buildings_and_passes_seen_through():
    buildings = [
        made_view("planner", 20, total=500),
        made_view("finance", 7, total=40),
        made_view("gym", 50, total=999, earning=False),
    ]
    belt = belt_view(buildings, BUILDING_IDS, seen_level=2)
    assert (belt.level, belt.total_xp, belt.seen_level) == (3, 540, 2)


@pytest.mark.parametrize(
    ("seen_level", "level", "progress"),
    [
        (5, 5, 0.0),  # a correction dropped the sum: the level already shown stays
        (3, 3, 2 / 9),  # level with what was shown: the bar is the real one
        (2, 3, 2 / 9),  # above it: nothing is held
    ],
)
def test_belt_level_never_goes_below_the_one_shown(seen_level, level, progress):
    belt = belt_view([made_view("planner", 29, total=70)], BUILDING_IDS, seen_level=seen_level)
    assert (belt.level, belt.total_xp, belt.seen_level) == (level, 70, seen_level)
    assert belt.progress == pytest.approx(progress)


# --- Migration 018 ----------------------------------------------------------------------


def test_migration_backfills_refreshes_and_project_events(tmp_path):
    path = tmp_path / "sample.db"
    old = open_database(path, DbKind.SAMPLE, migrations=load_migrations()[:17])
    for platform_id, updated_on in (("platform_a", "2026-11-20"), ("platform_b", None)):
        old.execute(
            "INSERT INTO platform_profiles (platform_id, profile_updated_on, updated_at) "
            "VALUES (?, ?, ?)",
            (platform_id, updated_on, STAMP),
        )
    old.execute(
        "INSERT INTO job_projects (id, platform_id, title, status, found_on, status_at) "
        "VALUES (7, 'platform_a', 'Example', 'active', '2026-11-01', ?)",
        (STAMP,),
    )
    old.close()

    conn = open_database(path, DbKind.SAMPLE)
    try:
        assert conn.execute(
            "SELECT platform_id, refreshed_on, created_at FROM platform_profile_refreshes"
        ).fetchall() == [("platform_a", "2026-11-20", STAMP)]
        assert events(conn) == [(7, "active", STAMP)]
        # An active project has reached four stages; one profile refresh on top.
        assert xp(conn, "jobs") == 15 + 4 * 20 + 20
    finally:
        conn.close()


@pytest.mark.parametrize("table", ["platform_profile_refreshes", "job_project_events"])
@pytest.mark.parametrize("change", ["DELETE FROM {}", "UPDATE {} SET id = id"])
def test_xp_history_is_append_only(conn, jobs, table, change):
    project(jobs)
    conn.execute(
        "INSERT INTO platform_profile_refreshes (platform_id, refreshed_on, created_at) "
        "VALUES ('platform_a', '2026-11-29', ?)",
        (STAMP,),
    )
    with pytest.raises(Exception, match="permanent"):
        conn.execute(change.format(table))


@pytest.mark.parametrize(
    "sql",
    [
        (
            "INSERT INTO platform_profile_refreshes (platform_id, refreshed_on, created_at) "
            "VALUES ('platform_a', '2026-02-30', '2026-11-29T15:00:00Z')"
        ),
        "INSERT INTO routine_finishes VALUES ('2026-11-29', 'Bad ID', '2026-11-29T15:00:00Z')",
        "INSERT INTO routine_finishes VALUES ('2026-11-29', 'prep', 'yesterday')",
        "INSERT INTO xp_seen VALUES ('belt', 101, 0, '2026-11-29T15:00:00Z')",
        "INSERT INTO xp_seen VALUES ('belt', 1, 11, '2026-11-29T15:00:00Z')",
    ],
)
def test_new_tables_refuse_bad_data(conn, sql):
    with pytest.raises(Exception, match="CHECK constraint"):
        conn.execute(sql)


# --- In step with the page ----------------------------------------------------------------


def test_earning_buildings_match_frontend_built():
    """Buildings earn XP once they're built: when one ships, both lists change together."""
    source = (Path(__file__).resolve().parents[1] / "frontend/src/belt/built.ts").read_text()
    literal = re.search(r"BUILT\b[^=]*=\s*new Set<BuildingId>\(\[(.*?)\]\)", source, re.DOTALL)
    assert literal, "Couldn't find the BUILT set in built.ts."
    assert set(re.findall(r'"([a-z_]+)"', literal[1])) == xp_rules.EARNING_BUILDINGS
