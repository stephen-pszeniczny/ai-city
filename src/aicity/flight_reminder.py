"""Flight School's monthly to-do (Personal mode only).

From the reminder day (settings [career] reminder_day, default the 1st) at the usual
reminder time, if last month isn't done and has no to-do yet, one Mission Control to-do
appears: "Log last month for Flight School". Its reminder is that moment, so the normal
task reminder brings the shuttle, ticker and Mac notification. A Mac asleep on the day
gets it at the next check that month. The to-do is linked to the month, so it's made
once, and it's completed when the month is done (flight_store.py). Runs from the
background reminder check.
"""

import sqlite3
from datetime import UTC, date, datetime, time, timedelta

from aicity.career_settings import CareerSettings
from aicity.db import with_transaction
from aicity.tasks import TaskStore

TODO_TITLE = "Log last month for Flight School"
TODO_NOTES = "Run /flight-log in Claude Code."
_STAMP_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


def check_flight_todo(
    conn: sqlite3.Connection,
    now_local: datetime,
    settings: CareerSettings,
    reminder_time: time,
    tasks: TaskStore,
) -> int:
    """Make last month's to-do if it's due. Returns how many were made (0 or 1)."""
    today = now_local.date()
    due = datetime.combine(today.replace(day=settings.reminder_day), reminder_time)
    if now_local.replace(tzinfo=None) < due:
        return 0
    month = _month_before(today)

    def work() -> int:
        row = conn.execute(
            "SELECT status, todo_task_id FROM fs_months WHERE month = ?", (month,)
        ).fetchone()
        if row is not None and (row[0] == "done" or row[1] is not None):
            return 0
        todo = tasks.create(
            title=TODO_TITLE,
            category="personal",
            notes=TODO_NOTES,
            reminder_at=f"{due:%Y-%m-%dT%H:%M}",
        )
        stamp = datetime.now(UTC).strftime(_STAMP_FORMAT)
        if row is None:
            conn.execute(
                "INSERT INTO fs_months (month, status, todo_task_id, updated_at) "
                "VALUES (?, 'draft', ?, ?)",
                (month, todo.id, stamp),
            )
        else:
            conn.execute(
                "UPDATE fs_months SET todo_task_id = ?, updated_at = ? WHERE month = ?",
                (todo.id, stamp, month),
            )
        return 1

    return with_transaction(conn, work, immediate=True)


def _month_before(day: date) -> str:
    return f"{day.replace(day=1) - timedelta(days=1):%Y-%m}"
