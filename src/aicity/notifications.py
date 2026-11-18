"""The notification list behind the shuttle and the ticker (SPEC section 7, "Notifications").

check_reminders() turns reminders that have come due into notifications. It
runs in the background every 30 seconds (src/aicity/reminder_loop.py) and:
  - the first time it runs on a database, stores a start date in meta
    (notifications_since); reminders before that never fire, so a first run
    doesn't bring a pile of old reminders. After that nothing is skipped,
    including reminders that came due while the app or the Mac was off;
  - makes one notification per (task, reminder time), never two;
  - clears active ones whose task was finished or archived, or whose reminder
    was changed or removed;
  - deletes ones that have been dismissed or cleared for 90 days, once their task
    no longer has that reminder time (until then the row stops a second firing).

Reminder times are local Mac time to the minute ("2026-11-30T09:00"), so "due"
is a plain text comparison in that format. Only the task's title is copied.
"""

import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, tzinfo

from aicity.db import with_transaction

SINCE_KEY = "notifications_since"
KEEP_DAYS = 90

_LOCAL_FORMAT = "%Y-%m-%dT%H:%M"
_STAMP_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


class NotificationNotFound(LookupError):
    """No notification has that ID."""


class NotificationConflict(ValueError):
    """The change isn't allowed in the notification's current state."""


@dataclass(frozen=True)
class Notification:
    id: int
    kind: str
    task_id: int | None
    title: str
    due_at: str
    seen: bool


class NotificationStore:
    """All notification reads and writes for one open database."""

    def __init__(
        self,
        conn: sqlite3.Connection,
        clock: Callable[[], datetime],
        local_tz: tzinfo | None = None,
    ) -> None:
        self._conn = conn
        self._clock = clock
        self._local_tz = local_tz  # None: the Mac's own time zone

    def check_reminders(self) -> int:
        """Turn due reminders into notifications. Returns how many were made."""
        now = self._now()
        local_now = now.astimezone(self._local_tz).strftime(_LOCAL_FORMAT)
        stamp = now.strftime(_STAMP_FORMAT)
        cutoff = (now - timedelta(days=KEEP_DAYS)).strftime(_STAMP_FORMAT)
        conn = self._conn

        def work() -> int:
            row = conn.execute("SELECT value FROM meta WHERE key = ?", (SINCE_KEY,)).fetchone()
            if row is None:
                conn.execute("INSERT INTO meta (key, value) VALUES (?, ?)", (SINCE_KEY, local_now))
                since = local_now
            else:
                since = row[0]
            # Clear active reminders whose task no longer wants them.
            conn.execute(
                """UPDATE notifications SET cleared_at = ?
                   WHERE kind = 'reminder' AND dismissed_at IS NULL AND cleared_at IS NULL
                     AND NOT EXISTS (SELECT 1 FROM tasks t
                                     WHERE t.id = notifications.task_id AND t.status = 'open'
                                       AND t.reminder_at = notifications.due_at)""",
                (stamp,),
            )
            made = conn.execute(
                """INSERT OR IGNORE INTO notifications (kind, task_id, title, due_at, created_at)
                   SELECT 'reminder', id, title, reminder_at, ? FROM tasks
                   WHERE status = 'open' AND reminder_at IS NOT NULL
                     AND reminder_at <= ? AND reminder_at >= ?""",
                (stamp, local_now, since),
            ).rowcount
            # Old dismissed/cleared rows go, but only once nothing could recreate them:
            # while the task still has that reminder time, the row is what stops it
            # firing a second time.
            conn.execute(
                """DELETE FROM notifications WHERE COALESCE(dismissed_at, cleared_at) < ?
                   AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = notifications.task_id
                                   AND t.reminder_at = notifications.due_at)""",
                (cutoff,),
            )
            return made

        return with_transaction(conn, work, immediate=True)

    def list_active(self) -> list[Notification]:
        rows = self._conn.execute(
            """SELECT id, kind, task_id, title, due_at, seen_at IS NOT NULL FROM notifications
               WHERE dismissed_at IS NULL AND cleared_at IS NULL ORDER BY due_at, id"""
        ).fetchall()
        return [Notification(r[0], r[1], r[2], r[3], r[4], bool(r[5])) for r in rows]

    def last_id(self) -> int:
        """The newest notification's ID (0 if none): note it before a check."""
        row = self._conn.execute("SELECT COALESCE(MAX(id), 0) FROM notifications").fetchone()
        return int(row[0])

    def created_after(self, nid: int) -> list[Notification]:
        """Active notifications made after the one with ID nid, oldest first."""
        return [n for n in self.list_active() if n.id > nid]

    def mark_seen(self, nid: int) -> None:
        """The shuttle has flown for it. Marking twice is fine."""
        self._row(nid)
        stamp = self._now().strftime(_STAMP_FORMAT)
        with_transaction(
            self._conn,
            lambda: self._conn.execute(
                "UPDATE notifications SET seen_at = COALESCE(seen_at, ?) WHERE id = ?",
                (stamp, nid),
            ),
        )

    def dismiss(self, nid: int) -> None:
        dismissed_at, cleared_at = self._row(nid)
        if dismissed_at is not None or cleared_at is not None:
            raise NotificationConflict("That notification is no longer active.")
        stamp = self._now().strftime(_STAMP_FORMAT)
        with_transaction(
            self._conn,
            lambda: self._conn.execute(
                "UPDATE notifications SET dismissed_at = ? WHERE id = ?", (stamp, nid)
            ),
        )

    def _row(self, nid: int) -> tuple:
        row = self._conn.execute(
            "SELECT dismissed_at, cleared_at FROM notifications WHERE id = ?", (nid,)
        ).fetchone()
        if row is None:
            raise NotificationNotFound(f"No notification with ID {nid}.")
        return row

    def _now(self) -> datetime:
        now = self._clock()
        if now.tzinfo is None:
            raise ValueError("The clock must return a timezone-aware time.")
        return now.astimezone(UTC)
