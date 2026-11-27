"""Belt XP: each building's XP, worked out from what the database records.

Nothing is stored or kept in step: XP is counted from the records as they stand, so
past work counts, and correcting a record (reopening a to-do, removing a typed pay)
corrects the XP. Resting never takes any away. Values and caps are in xp_rules.

building_xp only reads. backfill_routine_finishes writes, once per database.
"""

import sqlite3
from collections import Counter
from collections.abc import Callable, Iterable
from datetime import UTC, datetime, tzinfo

from aicity import xp_rules
from aicity.db import with_transaction
from aicity.settings import Routine

_STAMP_FORMAT = "%Y-%m-%dT%H:%M:%SZ"
_BACKFILL_KEY = "xp_routine_backfill"
# The order a project moves through; each step past "found" is a stage. "rejected"
# isn't a step, so being rejected never takes stages away.
_PROJECT_ORDER = ("found", "applied", "assessment", "accepted", "active", "ended")


def building_xp(
    conn: sqlite3.Connection, building: str, routines: tuple[Routine, ...], tz: tzinfo
) -> int:
    """A building's total XP. 0 for any building that isn't earning yet.

    tz decides which local day a time falls on, for the daily caps. Routine XP comes
    from the finishes recorded at the time, so today's routine settings don't change it
    (`routines` is only needed by backfill_routine_finishes).
    """
    if building not in xp_rules.EARNING_BUILDINGS:
        return 0
    return _TOTALS[building](conn, tz)


def backfill_routine_finishes(
    conn: sqlite3.Connection, routines: tuple[Routine, ...], clock: Callable[[], datetime]
) -> None:
    """Once per database: record finishes for routine days fully ticked before Belt XP.

    A day counts when its ticks cover every item the routine has now.
    """

    def work() -> None:
        if conn.execute("SELECT 1 FROM meta WHERE key = ?", (_BACKFILL_KEY,)).fetchone():
            return
        stamp = clock().astimezone(UTC).strftime(_STAMP_FORMAT)
        for routine in routines:
            marks = ", ".join("?" * len(routine.items))
            conn.execute(
                "INSERT OR IGNORE INTO routine_finishes (day, routine_id, finished_at) "
                "SELECT day, routine_id, ? FROM routine_ticks "
                f"WHERE routine_id = ? AND item IN ({marks}) "
                "GROUP BY day, routine_id HAVING count(DISTINCT item) = ?",
                (stamp, routine.id, *routine.items, len(set(routine.items))),
            )
        conn.execute("INSERT INTO meta (key, value) VALUES (?, ?)", (_BACKFILL_KEY, stamp))

    with_transaction(conn, work, immediate=True)


# --- One total per building -------------------------------------------------


def _planner(conn: sqlite3.Connection, tz: tzinfo) -> int:
    # A to-do counts once, on the day it was last completed, unless it was reopened
    # after that. Archiving it afterwards changes nothing.
    completions = conn.execute(
        "SELECT h.at FROM task_history h WHERE h.id IN "
        "(SELECT max(id) FROM task_history WHERE kind = 'completed' GROUP BY task_id) "
        "AND NOT EXISTS (SELECT 1 FROM task_history r "
        "WHERE r.task_id = h.task_id AND r.kind = 'reopened' AND r.id > h.id)"
    )
    return (
        xp_rules.TODO_XP * _capped_per_day(completions, tz, xp_rules.TODOS_PER_DAY)
        + xp_rules.GYM_XP * _count(conn, "plan_blocks WHERE kind = 'gym' AND status = 'done'")
        + xp_rules.ROUTINE_XP * _count(conn, "routine_finishes")
        + xp_rules.CHECKIN_XP * _count(conn, "plan_weeks WHERE checked_in_at IS NOT NULL")
    )


def _finance(conn: sqlite3.Connection, tz: tzinfo) -> int:
    confirmed = _count(
        conn,
        "main_job_payments WHERE archived_at IS NULL "
        "AND (deposit_id IS NOT NULL OR hand_checked_at IS NOT NULL)",
    ) + _count(conn, "side_work_payments WHERE deposit_id IS NOT NULL")
    statement_months = conn.execute(
        "SELECT count(DISTINCT substr(last_day, 1, 7)) FROM statement_imports"
    ).fetchone()[0]
    return (
        xp_rules.SIDE_WORK_ENTRY_XP * _count(conn, "side_work_entries WHERE archived = 0")
        + xp_rules.PAY_CONFIRMED_XP * confirmed
        + xp_rules.STATEMENT_XP * statement_months
    )


def _jobs(conn: sqlite3.Connection, tz: tzinfo) -> int:
    checks = conn.execute("SELECT checked_at FROM platform_checks")
    return (
        xp_rules.CHECK_XP * _capped_per_day(checks, tz, xp_rules.CHECKS_PER_DAY)
        + xp_rules.PROJECT_XP * _count(conn, "job_projects")
        + xp_rules.PROJECT_STAGE_XP * _project_stages(conn)
        + xp_rules.PROFILE_REFRESH_XP * _count(conn, "platform_profile_refreshes")
    )


def _career(conn: sqlite3.Connection, tz: tzinfo) -> int:
    # Study days are already local calendar days. Each day's minutes are added up first.
    study = sum(
        min(minutes, xp_rules.STUDY_MINUTES_PER_DAY) // xp_rules.STUDY_MINUTES_PER_XP
        for (minutes,) in conn.execute("SELECT sum(minutes) FROM fs_study GROUP BY day")
    )
    return (
        xp_rules.MONTH_LOGGED_XP * _count(conn, "fs_months WHERE status = 'done'")
        + xp_rules.EXAMPLE_XP * _count(conn, "fs_examples WHERE status = 'ready'")
        + study
    )


_TOTALS = {"planner": _planner, "finance": _finance, "jobs": _jobs, "career": _career}


# --- Helpers ----------------------------------------------------------------


def _count(conn: sqlite3.Connection, source: str) -> int:
    """Rows in `source`: a table name and optional WHERE, always written in this file."""
    return conn.execute(f"SELECT count(*) FROM {source}").fetchone()[0]


def _capped_per_day(stamps: Iterable[tuple[str]], tz: tzinfo, cap: int) -> int:
    """How many UTC stamps count when each local day counts at most `cap` of them."""
    days = Counter(datetime.fromisoformat(stamp).astimezone(tz).date() for (stamp,) in stamps)
    return sum(min(n, cap) for n in days.values())


def _project_stages(conn: sqlite3.Connection) -> int:
    """Each project's furthest stage ever reached (0 to 5), added up."""
    reached: dict[int, set[str]] = {}
    for project_id, status in conn.execute("SELECT project_id, status FROM job_project_events"):
        reached.setdefault(project_id, set()).add(status)
    return sum(
        # Only "rejected" known (history from before Belt XP): it got at least one step.
        1
        if statuses == {"rejected"}
        else max(_PROJECT_ORDER.index(s) for s in statuses if s != "rejected")
        for statuses in reached.values()
    )
