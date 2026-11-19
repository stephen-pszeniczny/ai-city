"""Routine reminders (Personal mode only): "Evening prep: not done yet".

At a routine's remind_at (optional, from settings), on a day it runs, if any item is
still unticked, one 'routine' notification is made: the shuttle, the ticker and a Mac
notification show it like a task reminder. One per routine per day. It's cleared
once every item is ticked, or once the day is over. Runs from the background check.
"""

import sqlite3
from datetime import date, datetime

from aicity.db import with_transaction
from aicity.routines import RoutineStore, routines_on
from aicity.settings import Routine

_STAMP_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


def routine_title(routine: Routine) -> str:
    return f"{routine.title}: not done yet"


def clear_routine_reminders(
    conn: sqlite3.Connection, routines: tuple[Routine, ...], today: date, clock_utc: datetime
) -> None:
    """Clear routine reminders from past days, and any whose routine is fully ticked."""
    stamp = clock_utc.strftime(_STAMP_FORMAT)
    active = "kind = 'routine' AND dismissed_at IS NULL AND cleared_at IS NULL"
    conn.execute(
        f"UPDATE notifications SET cleared_at = ? WHERE {active} AND substr(due_at, 1, 10) < ?",
        (stamp, today.isoformat()),
    )
    for view in RoutineStore(conn).day_view(routines, today):
        if view.done == view.total:
            conn.execute(
                f"UPDATE notifications SET cleared_at = ? WHERE {active} "
                "AND routine_id = ? AND substr(due_at, 1, 10) = ?",
                (stamp, view.id, today.isoformat()),
            )


def check_routine_reminders(
    conn: sqlite3.Connection,
    now_local: datetime,
    routines: tuple[Routine, ...],
    clock_utc: datetime,
) -> int:
    """Make today's due routine reminders. Returns how many were made."""
    now = now_local.replace(tzinfo=None)
    today = now.date()
    stamp = clock_utc.strftime(_STAMP_FORMAT)

    def work() -> int:
        clear_routine_reminders(conn, routines, today, clock_utc)
        views = {v.id: v for v in RoutineStore(conn).day_view(routines, today)}
        made = 0
        for routine in routines_on(routines, today):
            if routine.remind_at is None or now.time() < routine.remind_at:
                continue
            view = views[routine.id]
            if view.done == view.total:
                continue
            made += conn.execute(
                "INSERT OR IGNORE INTO notifications "
                "(kind, task_id, routine_id, title, due_at, created_at) "
                "VALUES ('routine', NULL, ?, ?, ?, ?)",
                (routine.id, routine_title(routine), f"{today}T{routine.remind_at:%H:%M}", stamp),
            ).rowcount
        return made

    return with_transaction(conn, work, immediate=True)
