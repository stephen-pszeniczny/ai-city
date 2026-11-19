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
BLOCK_KINDS = ("work", "commute", "gym", "event", "side_work", "build", "other")
EDITABLE_FIELDS = ("day", "start", "end", "title", "kind")
GYM_STATUSES = ("planned", "done", "skipped")
GYM_DAYS_BACK = 7
TITLE_MAX = 100
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

    # --- Changing blocks --------------------------------------------------
    # Every change takes today's date: past days can't be changed (except gym).

    def add_block(
        self,
        week_start: date,
        day: date,
        start: time,
        end: time,
        title: str,
        kind: str,
        today: date,
    ) -> Block:
        _require_monday(week_start)
        title = _check_fields(day, start, end, title, kind, week_start, today)

        def work() -> int:
            week_id = self._week_id(week_start)
            stamp = self._stamp()
            return self._conn.execute(
                "INSERT INTO plan_blocks (week_id, day, start_time, end_time, title, kind, "
                "source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'added', ?, ?)",
                (
                    week_id,
                    day.isoformat(),
                    f"{start:%H:%M}",
                    f"{end:%H:%M}",
                    title,
                    kind,
                    stamp,
                    stamp,
                ),
            ).lastrowid

        return self.get_block(self._write(work))

    def edit_block(self, block_id: int, today: date, **fields) -> Block:
        """Change any of day, start, end, title, kind. A settings block becomes "edited"."""
        unknown = sorted(set(fields) - set(EDITABLE_FIELDS))
        if unknown:
            raise PlanError(f"These can't be changed: {', '.join(unknown)}.")
        block = self._changeable(block_id, today)
        week_start = monday_of(date.fromisoformat(block.day))
        day = fields.get("day", date.fromisoformat(block.day))
        start = fields.get("start", time.fromisoformat(block.start))
        end = fields.get("end", time.fromisoformat(block.end))
        title = _check_fields(
            day,
            start,
            end,
            fields.get("title", block.title),
            fields.get("kind", block.kind),
            week_start,
            today,
        )
        kind = fields.get("kind", block.kind)

        def work() -> None:
            self._conn.execute(
                "UPDATE plan_blocks SET day = ?, start_time = ?, end_time = ?, title = ?, kind = ?, "
                "edited = CASE WHEN source = 'settings' THEN 1 ELSE 0 END, updated_at = ? "
                "WHERE id = ?",
                (
                    day.isoformat(),
                    f"{start:%H:%M}",
                    f"{end:%H:%M}",
                    title,
                    kind,
                    self._stamp(),
                    block_id,
                ),
            )

        self._write(work)
        return self.get_block(block_id)

    def remove_block(self, block_id: int, today: date) -> Block:
        self._changeable(block_id, today)
        self._write(lambda: self._set_status(block_id, "removed"))
        return self.get_block(block_id)

    def set_gym(self, block_id: int, status: str, today: date) -> Block:
        """Mark a gym block done, skipped, or back to planned (today or the last 7 days)."""
        if status not in GYM_STATUSES:
            raise PlanError(f"Gym can be marked: {', '.join(GYM_STATUSES)}.")
        block = self.get_block(block_id)
        if block.status in _HIDDEN:
            raise PlanError("That block was removed.")
        if block.kind != "gym":
            raise PlanError("Only gym blocks can be marked done or skipped.")
        day = date.fromisoformat(block.day)
        if day > today:
            raise PlanError("Gym can only be marked on or after its day.")
        if day < today - timedelta(days=GYM_DAYS_BACK):
            raise PlanError("Gym can only be marked for the last 7 days.")
        self._write(lambda: self._set_status(block_id, status))
        return self.get_block(block_id)

    # --- Rebuilding a week ------------------------------------------------

    def rebuild_week(self, week_start: date, rules: PlanSettings, today: date) -> Week:
        """Refresh untouched settings blocks from today on; Steve's changes stay.

        For each day from today: settings blocks still planned and not edited are
        marked 'replaced', then the rules' blocks for that day are added, except a
        rule whose block Steve removed, edited or marked done/skipped that day.
        Added blocks and past days are never touched.
        """
        _require_monday(week_start)

        def work() -> None:
            week_id = self._week_id(week_start)
            stamp = self._stamp()
            fresh = blocks_for_week(rules, week_start)
            for n in range(7):
                day = week_start + timedelta(days=n)
                if day < today:
                    continue
                rows = self._conn.execute(
                    "SELECT id, settings_key, status, edited FROM plan_blocks "
                    "WHERE week_id = ? AND day = ? AND source = 'settings' AND status <> 'replaced'",
                    (week_id, day.isoformat()),
                ).fetchall()
                touched = {key for _, key, status, edited in rows if edited or status != "planned"}
                for block_id, _, status, edited in rows:
                    if status == "planned" and not edited:
                        self._conn.execute(
                            "UPDATE plan_blocks SET status = 'replaced', updated_at = ? WHERE id = ?",
                            (stamp, block_id),
                        )
                for block in fresh:
                    if block.day == day and block.settings_key not in touched:
                        self._insert_settings_block(week_id, block, stamp)

        self._write(work)
        week = self.get_week(week_start)
        assert week is not None  # _week_id above proved it's saved
        return week

    # --- Helpers ----------------------------------------------------------

    def _changeable(self, block_id: int, today: date) -> Block:
        block = self.get_block(block_id)
        if block.status in _HIDDEN:
            raise PlanError("That block was removed.")
        if date.fromisoformat(block.day) < today:
            raise PlanError(PAST_DAY)
        return block

    def _set_status(self, block_id: int, status: str) -> None:
        self._conn.execute(
            "UPDATE plan_blocks SET status = ?, updated_at = ? WHERE id = ?",
            (status, self._stamp(), block_id),
        )

    def _week_id(self, week_start: date) -> int:
        row = self._conn.execute(
            "SELECT id FROM plan_weeks WHERE week_start = ?", (week_start.isoformat(),)
        ).fetchone()
        if row is None:
            raise PlanError("That week isn't saved yet. Open it first.")
        return row[0]

    def _write(self, work):
        """Run work() as one all-or-nothing change; data the database refuses is a PlanError."""
        try:
            return with_transaction(self._conn, work, immediate=True)
        except sqlite3.IntegrityError:
            # The SQLite message can quote values, so it isn't passed on.
            raise PlanError("The block data isn't valid.") from None

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


PAST_DAY = "Past days can't be changed."


def _check_fields(
    day: date, start: time, end: time, title: str, kind: str, week_start: date, today: date
) -> str:
    """Check a block's fields; returns the trimmed title. Raises PlanError."""
    if not week_start <= day <= week_start + timedelta(days=6):
        raise PlanError("A block's day must be inside its week.")
    if day < today:
        raise PlanError(PAST_DAY)
    if end <= start:
        raise PlanError("A block must end later than it starts (none past midnight).")
    if start.second or start.microsecond or end.second or end.microsecond:
        raise PlanError("Times are to the minute.")
    title = title.strip() if isinstance(title, str) else ""
    if not 1 <= len(title) <= TITLE_MAX:
        raise PlanError(f"A block needs a title of 1 to {TITLE_MAX} characters.")
    if kind not in BLOCK_KINDS:
        raise PlanError(f"A block's kind must be one of: {', '.join(BLOCK_KINDS)}.")
    return title


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
