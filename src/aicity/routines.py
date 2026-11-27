"""Routines: repeating prep checklists (e.g. "Evening prep") ticked off each day.

The routines themselves live in the settings file ([[routines]]); this module only
reads and changes which items are ticked. A routine belongs to a calendar day: ticks
are stored with that date, so each day starts fresh and there are no streaks. Only
today's routines can be ticked (past days are done with; future ones haven't started).
An item renamed or removed in settings just loses its old ticks.
"""

import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime

from aicity.db import with_transaction
from aicity.settings import Routine
from aicity.tasks import utc_now

_STAMP_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


class RoutineError(ValueError):
    """A tick that isn't allowed. The message is safe to show."""


class RoutineNotFound(LookupError):
    """No routine has that id in the settings."""


@dataclass(frozen=True)
class RoutineDay:
    """One routine on one day: its items in settings order, each with whether it's ticked."""

    id: str
    title: str
    shows_from: str
    remind_at: str | None
    items: list[tuple[str, bool]]
    done: int
    total: int


def routines_on(routines: tuple[Routine, ...], day: date) -> list[Routine]:
    """The routines that run on that day's weekday, in settings order."""
    return [r for r in routines if day.weekday() in r.days]


class RoutineStore:
    """Routine tick reads and writes for one open database."""

    def __init__(
        self, conn: sqlite3.Connection, *, clock: Callable[[], datetime] = utc_now
    ) -> None:
        self._conn = conn
        self._clock = clock

    def day_view(self, routines: tuple[Routine, ...], day: date) -> list[RoutineDay]:
        """Reads only. Every routine that runs that day, with its ticks."""
        return [self._view(r, day) for r in routines_on(routines, day)]

    def set_tick(
        self,
        routines: tuple[Routine, ...],
        routine_id: str,
        item: str,
        ticked: bool,
        day: date,
        today: date,
    ) -> RoutineDay:
        """Tick or untick one item of today's routine. Doing it twice changes nothing."""
        routine = next((r for r in routines if r.id == routine_id), None)
        if routine is None:
            raise RoutineNotFound(f"No routine with id {routine_id}.")
        if day.weekday() not in routine.days:
            raise RoutineError("That routine doesn't run on that day.")
        if day != today:
            raise RoutineError("Only today's routines can be ticked.")
        if item not in routine.items:
            raise RoutineError("That item isn't in the routine.")

        def work() -> None:
            if ticked:
                self._conn.execute(
                    "INSERT OR IGNORE INTO routine_ticks (day, routine_id, item, ticked_at) "
                    "VALUES (?, ?, ?, ?)",
                    (day.isoformat(), routine_id, item, self._stamp()),
                )
            else:
                removed = self._conn.execute(
                    "DELETE FROM routine_ticks WHERE day = ? AND routine_id = ? AND item = ?",
                    (day.isoformat(), routine_id, item),
                ).rowcount
            self._record_finish(routine, day, unticked=not ticked and removed > 0)

        with_transaction(self._conn, work, immediate=True)
        return self._view(routine, day)

    def _record_finish(self, routine: Routine, day: date, *, unticked: bool) -> None:
        """Keep routine_finishes in step: added once every current item is ticked.

        Only really unticking an item removes it (a correction). Belt XP counts these
        rows, so changing the routine's items never takes away what a day earned.
        """
        key = (day.isoformat(), routine.id)
        if self._view(routine, day).done == len(routine.items):
            self._conn.execute(
                "INSERT OR IGNORE INTO routine_finishes (day, routine_id, finished_at) "
                "VALUES (?, ?, ?)",
                (*key, self._stamp()),
            )
        elif unticked:
            self._conn.execute("DELETE FROM routine_finishes WHERE day = ? AND routine_id = ?", key)

    def _view(self, routine: Routine, day: date) -> RoutineDay:
        ticked = {
            row[0]
            for row in self._conn.execute(
                "SELECT item FROM routine_ticks WHERE day = ? AND routine_id = ?",
                (day.isoformat(), routine.id),
            )
        }
        items = [(item, item in ticked) for item in routine.items]
        return RoutineDay(
            id=routine.id,
            title=routine.title,
            shows_from=f"{routine.shows_from:%H:%M}",
            remind_at=None if routine.remind_at is None else f"{routine.remind_at:%H:%M}",
            items=items,
            done=sum(1 for _, t in items if t),
            total=len(items),
        )

    def _stamp(self) -> str:
        now = self._clock()
        if now.tzinfo is None:
            raise ValueError("The clock must return a timezone-aware time.")
        return now.astimezone(UTC).strftime(_STAMP_FORMAT)
