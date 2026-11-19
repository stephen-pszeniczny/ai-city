"""The monthly reminder to import last month's chequing statement (Personal mode only).

From the due day (income.statement_due_day, default 8) at the usual reminder time
(tasks.reminder_time), if no import covers a day of last month yet, one 'statement'
notification is made: the shuttle, the ticker and a Mac notification show it like a
task reminder. Only one per month, ever (dismissing it doesn't bring it back), and
it's cleared once last month is imported. Runs from the background reminder check.
"""

import sqlite3
from datetime import datetime, time

from aicity.db import with_transaction
from aicity.income import IncomeStore

STATEMENT_TITLE = "Time to import last month's chequing statement"

_STAMP_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


def check_statement_reminder(
    conn: sqlite3.Connection,
    now_local: datetime,
    due_day: int,
    reminder_time: time,
    clock_utc: datetime,
) -> int:
    """Make this month's statement reminder if it's due. Returns how many were made (0 or 1)."""
    stamp = clock_utc.strftime(_STAMP_FORMAT)
    today = now_local.date()

    def work() -> int:
        if IncomeStore(conn).covers_month_before(today):
            conn.execute(
                "UPDATE notifications SET cleared_at = ? WHERE kind = 'statement' "
                "AND dismissed_at IS NULL AND cleared_at IS NULL",
                (stamp,),
            )
            return 0
        if today.day < due_day or now_local.time() < reminder_time:
            return 0
        due_at = f"{today:%Y-%m}-{due_day:02d}T{reminder_time:%H:%M}"
        return conn.execute(
            "INSERT OR IGNORE INTO notifications (kind, task_id, title, due_at, created_at) "
            "VALUES ('statement', NULL, ?, ?, ?)",
            (STATEMENT_TITLE, due_at, stamp),
        ).rowcount

    return with_transaction(conn, work, immediate=True)
