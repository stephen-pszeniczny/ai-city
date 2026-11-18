"""The background reminder check: every 30 seconds while the app runs.

Checks every database file that exists (Personal and Sample), so a reminder is
caught even with no page open, and Personal reminders are caught while Sample
mode is on (they show after switching back). It runs once straight away at
start, which also catches reminders that came due while the app or Mac was off.

It never creates a database file, and a file it can't use is logged (by kind
only, never its contents) and skipped, so the other one is still checked.
"""

import logging
import sqlite3
import threading
from collections.abc import Callable
from datetime import datetime, tzinfo

from aicity.db import DatabaseError, DbKind, db_path, open_database
from aicity.notifications import Notification, NotificationStore

log = logging.getLogger(__name__)

Clock = Callable[[], datetime]


def check_all_databases(
    clock: Clock,
    local_tz: tzinfo | None = None,
    notify: Callable[[list[Notification]], None] | None = None,
) -> dict[DbKind, int]:
    """Run the reminder check on each database that exists. Returns how many each made.

    notify, if given, is called with the Personal database's newly made
    notifications (only when there are some), for Mac notifications. Sample's
    made-up reminders never go to it. A failing notify is logged and ignored.
    """
    made: dict[DbKind, int] = {}
    for kind in DbKind:
        path = db_path(kind)
        if not path.exists():
            continue
        try:
            conn = open_database(path, kind)
        # A broken file must not stop the other one being checked.
        except (DatabaseError, sqlite3.Error, OSError) as exc:
            log.warning(
                "Reminder check skipped the %s database (%s).", kind.value, type(exc).__name__
            )
            continue
        try:
            store = NotificationStore(conn, clock, local_tz)
            before = store.last_id()
            made[kind] = store.check_reminders()
            if notify is not None and kind is DbKind.PERSONAL:
                new = store.created_after(before)
                if new:
                    _tell(notify, new)
        except (sqlite3.Error, ValueError) as exc:
            log.warning(
                "Reminder check failed on the %s database (%s).", kind.value, type(exc).__name__
            )
        finally:
            conn.close()
    return made


def _tell(notify: Callable[[list[Notification]], None], new: list[Notification]) -> None:
    try:
        notify(new)
    # Anything at all: a Mac notification problem must never stop reminders being made.
    except Exception as exc:  # noqa: BLE001
        log.warning("Mac notification step failed (%s).", type(exc).__name__)


class ReminderLoop:
    """Runs check(clock) at once, then every `every_seconds`, until stop()."""

    def __init__(
        self,
        clock: Clock,
        every_seconds: float = 30.0,
        check: Callable[[Clock], object] = check_all_databases,
    ) -> None:
        self._clock = clock
        self._every = every_seconds
        self._check = check
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="reminder-check", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=1)

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                self._check(self._clock)
            # Anything at all: the thread must survive, or reminders would silently stop.
            except Exception as exc:  # noqa: BLE001
                log.warning("Reminder check failed (%s).", type(exc).__name__)
            self._stop.wait(self._every)
