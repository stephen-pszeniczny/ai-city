"""Belt XP: each building's XP, worked out from what the database records.

Nothing is stored or kept in step: XP is counted from the records as they stand, so
past work counts, and correcting a record (reopening a to-do, removing a typed pay)
corrects the XP. Resting never takes any away. Values and caps are in xp_rules.

The one thing remembered is what the page has already shown (XpStore): the last
level seen and the last upgrade celebrated. A level never shows below a celebrated
upgrade, even when a correction takes the XP under it.

building_xp and the views only read. XpStore's mark_ methods write, and so does
backfill_routine_finishes, once per database.
"""

import sqlite3
from collections import Counter
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, tzinfo

from aicity import xp_rules
from aicity.db import with_transaction
from aicity.settings import Routine

_STAMP_FORMAT = "%Y-%m-%dT%H:%M:%SZ"
_BACKFILL_KEY = "xp_routine_backfill"
# The order a project moves through; each step past "found" is a stage. "rejected"
# isn't a step, so being rejected never takes stages away.
_PROJECT_ORDER = ("found", "applied", "assessment", "accepted", "active", "ended")
_LEVELS_PER_TIER = 10  # an upgrade at every 10th level


class XpError(ValueError):
    """A change to the seen or celebrated state that isn't allowed."""


@dataclass(frozen=True)
class BuildingXp:
    """One building as the page shows it. All zeros for a building not earning yet."""

    id: str
    earning: bool
    xp: int
    level: int  # never below celebrated_tier * 10
    level_start_xp: int  # xp can be under this after a correction
    next_level_xp: int  # the same as level_start_xp at the top level
    tier: int  # upgrades reached, 0 to 10
    seen_level: int
    celebrated_tier: int
    upgrade_waiting: bool


@dataclass(frozen=True)
class BeltXp:
    level: int  # at least 1
    progress: float  # 0 to 1, towards the next belt level
    total_xp: int
    seen_level: int


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


def building_view(
    conn: sqlite3.Connection, building: str, routines: tuple[Routine, ...], tz: tzinfo
) -> BuildingXp:
    """A building's XP, level and upgrades, with what the page has already shown."""
    if building not in xp_rules.EARNING_BUILDINGS:
        return BuildingXp(building, False, 0, 0, 0, 0, 0, 0, 0, False)
    xp = building_xp(conn, building, routines, tz)
    seen_level, celebrated_tier = _seen(conn, building)
    level = max(xp_rules.level_for_xp(building, xp), celebrated_tier * _LEVELS_PER_TIER)
    tier = level // _LEVELS_PER_TIER
    return BuildingXp(
        id=building,
        earning=True,
        xp=xp,
        level=level,
        level_start_xp=xp_rules.xp_for_level(building, level),
        next_level_xp=xp_rules.xp_for_level(building, min(level + 1, xp_rules.MAX_LEVEL)),
        tier=tier,
        seen_level=seen_level,
        celebrated_tier=celebrated_tier,
        upgrade_waiting=tier > celebrated_tier,
    )


def belt_view(buildings: list[BuildingXp], all_ids: tuple[str, ...], *, seen_level: int) -> BeltXp:
    """The belt: every building's level added up, shared across all of all_ids.

    Buildings not earning count as level 0. seen_level is the stored one for "belt".
    """
    earning = [b for b in buildings if b.earning]
    levels = sum(b.level for b in earning)
    count = len(all_ids)
    level = max(1, levels // count)
    if levels < 2 * count:
        # The shown level stays 1 until the sum reaches two per building, so one bar
        # covers all of it and never starts over without a level change.
        progress = levels / (2 * count)
    elif level >= xp_rules.MAX_LEVEL:
        progress = 1.0
    else:
        progress = (levels % count) / count
    return BeltXp(level, progress, sum(b.xp for b in earning), seen_level)


class XpStore:
    """What the page has already shown, per building ID or "belt". It only goes up."""

    def __init__(self, conn: sqlite3.Connection, clock: Callable[[], datetime]) -> None:
        self._conn = conn
        self._clock = clock

    def seen(self, key: str) -> tuple[int, int]:
        """(seen_level, celebrated_tier); (0, 0) when nothing is stored."""
        return _seen(self._conn, key)

    def mark_seen(self, key: str, level: int) -> None:
        self._save(key, level, 0)

    def mark_celebrated(self, building: str, tier: int, current_tier: int) -> None:
        if tier > current_tier:
            raise XpError("That upgrade tier hasn't been reached yet.")
        self._save(building, 0, tier)

    def _save(self, key: str, seen_level: int, celebrated_tier: int) -> None:
        # One statement, so the higher value wins however two saves are ordered.
        stamp = self._clock().astimezone(UTC).strftime(_STAMP_FORMAT)
        self._conn.execute(
            "INSERT INTO xp_seen (key, seen_level, celebrated_tier, updated_at) "
            "VALUES (?, ?, ?, ?) ON CONFLICT (key) DO UPDATE SET "
            "seen_level = max(seen_level, excluded.seen_level), "
            "celebrated_tier = max(celebrated_tier, excluded.celebrated_tier), "
            "updated_at = excluded.updated_at",
            (key, seen_level, celebrated_tier, stamp),
        )


def backfill_routine_finishes(
    conn: sqlite3.Connection, routines: tuple[Routine, ...], clock: Callable[[], datetime]
) -> None:
    """Once per database: record finishes for routine days fully ticked before Belt XP.

    A day counts when its ticks cover every item the routine has now. With no routines
    in the settings nothing is done, so the one run is still there for later.
    """
    if not routines:
        return

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


def _seen(conn: sqlite3.Connection, key: str) -> tuple[int, int]:
    row = conn.execute(
        "SELECT seen_level, celebrated_tier FROM xp_seen WHERE key = ?", (key,)
    ).fetchone()
    return (row[0], row[1]) if row else (0, 0)


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
