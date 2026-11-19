"""Mission Control's Daily plan: saved weeks and their blocks.

A week runs Monday to Sunday. It's created ahead (at the Sunday check-in, or the
first time the Daily plan opens that week) from the fixed blocks in the settings
file, because the Mac is usually asleep in the morning: a plan made "each morning"
wouldn't exist when it's needed. After that the saved week is what Steve edits.

Only this week and next week can be created. A past week that was never saved
stays unsaved (it isn't made up after the fact), and weeks further ahead wait.

Times of day are local wall-clock "HH:MM"; stamps are UTC like 2026-11-25T15:00:00Z.
The clock is passed in, so tests can use a fake one.
"""

import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta

from aicity.db import with_transaction
from aicity.settings import PlanSettings
from aicity.tasks import utc_now

_STAMP_FORMAT = "%Y-%m-%dT%H:%M:%SZ"
_BLOCK_COLUMNS = "id, day, start_time, end_time, title, kind, source, settings_key, status, edited"
# Statuses that hide a block from the week (still kept in the table).
_HIDDEN = ("removed", "replaced")


class PlanError(ValueError):
    """A plan change that isn't allowed. The message is safe to show."""


class BlockNotFound(LookupError):
    """No block has that ID."""


@dataclass(frozen=True)
class NewBlock:
    """A block about to be made from a settings rule."""

    day: date
    start: time
    end: time
    title: str
    kind: str
    settings_key: str


@dataclass(frozen=True)
class Block:
    id: int
    day: str
    start: str
    end: str
    title: str
    kind: str
    source: str
    status: str
    edited: bool
    settings_key: str | None = None


@dataclass(frozen=True)
class Week:
    week_start: str
    checked_in: bool
    # Always seven (day, blocks) pairs, Monday first; hidden blocks left out.
    days: list[tuple[str, list[Block]]]


def monday_of(day: date) -> date:
    return day - timedelta(days=day.weekday())


def settings_key(kind: str, title: str) -> str:
    """Which settings rule a block came from, as stored in plan_blocks.settings_key."""
    return f"{kind}|{title}"


def blocks_for_week(rules: PlanSettings, week_start: date) -> list[NewBlock]:
    """One block per rule per listed day, sorted by day, then start time."""
    blocks = [
        NewBlock(
            day=week_start + timedelta(days=weekday),
            start=rule.start,
            end=rule.end,
            title=rule.title,
            kind=rule.kind,
            settings_key=settings_key(rule.kind, rule.title),
        )
        for rule in rules.blocks
        for weekday in rule.days
    ]
    return sorted(blocks, key=lambda b: (b.day, b.start))


class PlanStore:
    """All Daily plan reads and writes for one open database."""

    def __init__(
        self, conn: sqlite3.Connection, *, clock: Callable[[], datetime] = utc_now
    ) -> None:
        self._conn = conn
        self._clock = clock

    # --- Reading ----------------------------------------------------------

    def get_week(self, week_start: date) -> Week | None:
        row = self._conn.execute(
            "SELECT id, week_start, checked_in_at FROM plan_weeks WHERE week_start = ?",
            (week_start.isoformat(),),
        ).fetchone()
        if row is None:
            return None
        week_id, start, checked_in_at = row
        rows = self._conn.execute(
            f"SELECT {_BLOCK_COLUMNS} FROM plan_blocks "
            f"WHERE week_id = ? AND status NOT IN {_HIDDEN} ORDER BY day, start_time, id",
            (week_id,),
        ).fetchall()
        by_day: dict[str, list[Block]] = {
            (week_start + timedelta(days=n)).isoformat(): [] for n in range(7)
        }
        for r in rows:
            by_day[r[1]].append(_to_block(r))
        return Week(
            week_start=start, checked_in=checked_in_at is not None, days=list(by_day.items())
        )

    def get_block(self, block_id: int) -> Block:
        row = self._conn.execute(
            f"SELECT {_BLOCK_COLUMNS} FROM plan_blocks WHERE id = ?", (block_id,)
        ).fetchone()
        if row is None:
            raise BlockNotFound(f"No block with ID {block_id}.")
        return _to_block(row)

    # --- Creating a week --------------------------------------------------

    def ensure_week(self, week_start: date, rules: PlanSettings, today: date) -> Week | None:
        """The saved week; created from the rules first if it's this week or next.

        Returns None for an unsaved week outside that range.
        """
        _require_monday(week_start)
        this_monday = monday_of(today)

        def work() -> bool:
            exists = self._conn.execute(
                "SELECT 1 FROM plan_weeks WHERE week_start = ?", (week_start.isoformat(),)
            ).fetchone()
            if exists:
                return True
            if not this_monday <= week_start <= this_monday + timedelta(days=7):
                return False
            stamp = self._stamp()
            week_id = self._conn.execute(
                "INSERT INTO plan_weeks (week_start, created_at) VALUES (?, ?)",
                (week_start.isoformat(), stamp),
            ).lastrowid
            for block in blocks_for_week(rules, week_start):
                self._insert_settings_block(week_id, block, stamp)
            return True

        saved = with_transaction(self._conn, work, immediate=True)
        return self.get_week(week_start) if saved else None

    # --- Helpers ----------------------------------------------------------

    def _insert_settings_block(self, week_id: int, block: NewBlock, stamp: str) -> None:
        self._conn.execute(
            "INSERT INTO plan_blocks (week_id, day, start_time, end_time, title, kind, "
            "source, settings_key, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, 'settings', ?, ?, ?)",
            (
                week_id,
                block.day.isoformat(),
                f"{block.start:%H:%M}",
                f"{block.end:%H:%M}",
                block.title,
                block.kind,
                block.settings_key,
                stamp,
                stamp,
            ),
        )

    def _stamp(self) -> str:
        now = self._clock()
        if now.tzinfo is None:
            raise ValueError("The clock must return a timezone-aware time.")
        return now.astimezone(UTC).strftime(_STAMP_FORMAT)


def _require_monday(week_start: date) -> None:
    if week_start.weekday() != 0:
        raise PlanError("A week starts on a Monday.")


def _to_block(row: tuple) -> Block:
    block_id, day, start, end, title, kind, source, key, status, edited = row
    return Block(
        id=block_id,
        day=day,
        start=start,
        end=end,
        title=title,
        kind=kind,
        source=source,
        status=status,
        edited=bool(edited),
        settings_key=key,
    )
