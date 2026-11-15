"""City Hall's to-do list: creating, editing, completing and archiving tasks.

Every change is saved together with a history row in one transaction, so a
task and its history can never disagree. Tasks are never deleted; "delete"
in the app means archive, and an archived task can be reopened.

A task is stale when it's open and hasn't changed for `stale_after_days`
(from the settings file). Staleness is worked out each time a task is read,
never stored, so it can't go out of date.

Times are stored in UTC like 2026-11-15T21:00:00Z. The clock is passed in,
so tests can use a fake one.
"""

import json
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from aicity.db import with_transaction

CATEGORIES = ("work", "side_work", "personal", "city")
LIST_FILTERS = ("open", "done", "archived", "all")
EDITABLE_FIELDS = ("title", "notes", "category", "goal_date", "reminder_at")
_TIME_FORMAT = "%Y-%m-%dT%H:%M:%SZ"
_COLUMNS = (
    "id, title, notes, category, goal_date, reminder_at, "
    "status, created_at, updated_at, completed_at"
)


class TaskError(ValueError):
    """The request can't be done: bad data or a change that isn't allowed."""


class TaskNotFound(LookupError):
    """No task has that ID."""


@dataclass(frozen=True)
class Task:
    id: int
    title: str
    notes: str
    category: str
    goal_date: str | None
    reminder_at: str | None
    status: str
    created_at: str
    updated_at: str
    completed_at: str | None
    stale: bool


@dataclass(frozen=True)
class HistoryEvent:
    at: str
    kind: str
    changes: dict[str, list]


def utc_now() -> datetime:
    return datetime.now(UTC)


class TaskStore:
    """All to-do list reads and writes for one open database."""

    def __init__(
        self,
        conn: sqlite3.Connection,
        *,
        stale_after_days: int,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._conn = conn
        self._stale_after = timedelta(days=stale_after_days)
        self._clock = clock

    # --- Reading ----------------------------------------------------------

    def get(self, task_id: int) -> Task:
        return self._to_task(self._row(task_id), self._now())

    def list_tasks(self, status: str = "open") -> list[Task]:
        """Tasks with this status ('all' for every task): soonest goal date first, undated last."""
        if status not in LIST_FILTERS:
            raise TaskError(f"Unknown list filter. Use one of: {', '.join(LIST_FILTERS)}.")
        where, params = ("", ()) if status == "all" else ("WHERE status = ?", (status,))
        rows = self._conn.execute(
            f"SELECT {_COLUMNS} FROM tasks {where} ORDER BY goal_date IS NULL, goal_date, id",
            params,
        ).fetchall()
        now = self._now()
        return [self._to_task(r, now) for r in rows]

    def history(self, task_id: int) -> list[HistoryEvent]:
        """Every change to this task, oldest first."""
        self._row(task_id)  # raises TaskNotFound
        rows = self._conn.execute(
            "SELECT at, kind, changes FROM task_history WHERE task_id = ? ORDER BY id",
            (task_id,),
        ).fetchall()
        return [HistoryEvent(at, kind, json.loads(changes)) for at, kind, changes in rows]

    # --- Writing ----------------------------------------------------------

    def create(
        self,
        *,
        title: str,
        category: str,
        notes: str = "",
        goal_date: str | None = None,
        reminder_at: str | None = None,
    ) -> Task:
        values = {
            "title": title.strip(),
            "notes": notes,
            "category": category,
            "goal_date": goal_date,
            "reminder_at": reminder_at,
        }
        now = self._now()
        stamp = _stamp(now)

        def work() -> int:
            cur = self._conn.execute(
                "INSERT INTO tasks (title, notes, category, goal_date, reminder_at, "
                "status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'open', ?, ?)",
                (*values.values(), stamp, stamp),
            )
            task_id = cur.lastrowid
            changes = {k: [None, v] for k, v in values.items() if v not in (None, "")}
            self._record(task_id, stamp, "created", changes)
            return task_id

        return self.get(self._write(work))

    def edit(self, task_id: int, **fields) -> Task:
        """Change any of title, notes, category, goal_date, reminder_at. None clears a date."""
        unknown = set(fields) - set(EDITABLE_FIELDS)
        if unknown:
            raise TaskError(f"These fields can't be edited: {', '.join(sorted(unknown))}.")
        if isinstance(fields.get("title"), str):
            fields["title"] = fields["title"].strip()
        now = self._now()
        stamp = _stamp(now)

        def work() -> None:
            current = self._to_task(self._row(task_id), now)
            if current.status == "archived":
                raise TaskError("Archived tasks can't be edited. Reopen it first.")
            changes = {
                k: [getattr(current, k), v] for k, v in fields.items() if getattr(current, k) != v
            }
            if not changes:
                return
            sets = ", ".join(f"{k} = ?" for k in changes)
            self._conn.execute(
                f"UPDATE tasks SET {sets}, updated_at = ? WHERE id = ?",
                (*(new for _, new in changes.values()), stamp, task_id),
            )
            self._record(task_id, stamp, "edited", changes)

        self._write(work)
        return self.get(task_id)

    def complete(self, task_id: int) -> Task:
        return self._change_status(task_id, "done", allowed_from=("open",), kind="completed")

    def reopen(self, task_id: int) -> Task:
        """Back to open, from done or archived (archive is how tasks are 'deleted')."""
        return self._change_status(
            task_id, "open", allowed_from=("done", "archived"), kind="reopened"
        )

    def archive(self, task_id: int) -> Task:
        return self._change_status(
            task_id, "archived", allowed_from=("open", "done"), kind="archived"
        )

    # --- Internals --------------------------------------------------------

    def _change_status(
        self, task_id: int, new: str, *, allowed_from: tuple[str, ...], kind: str
    ) -> Task:
        stamp = _stamp(self._now())

        def work() -> None:
            old = self._row(task_id)[6]
            if old not in allowed_from:
                raise TaskError(f"A task that is {old} can't be {kind}.")
            self._conn.execute(
                "UPDATE tasks SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?",
                (new, stamp, stamp if new == "done" else None, task_id),
            )
            self._record(task_id, stamp, kind, {"status": [old, new]})

        self._write(work)
        return self.get(task_id)

    def _write(self, work):
        """Run work() as one all-or-nothing change; bad data becomes a TaskError."""
        try:
            return with_transaction(self._conn, work, immediate=True)
        except sqlite3.IntegrityError:
            # The database's own checks refused the data. The SQLite message
            # can quote values, so it isn't passed on.
            raise TaskError("The task data isn't valid.") from None

    def _record(self, task_id: int, stamp: str, kind: str, changes: dict) -> None:
        self._conn.execute(
            "INSERT INTO task_history (task_id, at, kind, changes) VALUES (?, ?, ?, ?)",
            (task_id, stamp, kind, json.dumps(changes)),
        )

    def _row(self, task_id: int) -> tuple:
        row = self._conn.execute(
            f"SELECT {_COLUMNS} FROM tasks WHERE id = ?", (task_id,)
        ).fetchone()
        if row is None:
            raise TaskNotFound(f"No task with ID {task_id}.")
        return row

    def _to_task(self, row: tuple, now: datetime) -> Task:
        status, updated_at = row[6], row[8]
        stale = status == "open" and now - _parse(updated_at) >= self._stale_after
        return Task(*row, stale=stale)

    def _now(self) -> datetime:
        now = self._clock()
        if now.tzinfo is None:
            raise ValueError("The clock must return a timezone-aware time.")
        return now.astimezone(UTC)


def _stamp(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime(_TIME_FORMAT)


def _parse(stamp: str) -> datetime:
    return datetime.strptime(stamp, _TIME_FORMAT).replace(tzinfo=UTC)
