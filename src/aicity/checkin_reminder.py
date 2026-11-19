"""The weekly reminder to do the Sunday check-in (Personal mode only).

When the week the check-in plans isn't checked in yet and its reminder moment has
passed (the Sunday before that week, at plan.checkin_reminder), one 'checkin'
notification is made: the shuttle, the ticker and a Mac notification show it like
a task reminder. A Mac asleep at that moment gets it at the next check (on Monday
it's for this week, still not planned). Only one per week, ever: dismissing it
doesn't bring it back. Once the week is checked in, it's cleared.
Runs from the background reminder check.
"""

import sqlite3
from datetime import datetime

from aicity.db import with_transaction
from aicity.plan import PlanStore
from aicity.settings import PlanSettings

CHECKIN_TITLE = "Time for your Sunday check-in"

_STAMP_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


def check_checkin_reminder(
    conn: sqlite3.Connection, now_local: datetime, rules: PlanSettings, clock_utc: datetime
) -> int:
    """Make this week's check-in reminder if it's due. Returns how many were made (0 or 1)."""
    stamp = clock_utc.strftime(_STAMP_FORMAT)

    def work() -> int:
        status = PlanStore(conn).checkin_status(now_local, rules)
        if status.checked_in:
            conn.execute(
                "UPDATE notifications SET cleared_at = ? WHERE kind = 'checkin' "
                "AND dismissed_at IS NULL AND cleared_at IS NULL",
                (stamp,),
            )
            return 0
        if now_local.replace(tzinfo=None) < status.reminder_at:
            return 0
        return conn.execute(
            "INSERT OR IGNORE INTO notifications (kind, task_id, title, due_at, created_at) "
            "VALUES ('checkin', NULL, ?, ?, ?)",
            (CHECKIN_TITLE, f"{status.reminder_at:%Y-%m-%dT%H:%M}", stamp),
        ).rowcount

    return with_transaction(conn, work, immediate=True)
