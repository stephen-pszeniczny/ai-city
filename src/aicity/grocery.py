"""Mission Control's grocery list: add items, tick them off, clear ticked ones.

Items are never deleted: "remove" (one item) and "clear ticked" (everything bought)
set status = 'cleared'. Adding a name already on the list (ignoring case and spaces at
the ends), ticked or not, returns that item instead of a second one, unticked if it was
ticked (you need it again). Unticked items come first (oldest first), then ticked ones
in the order they were ticked. Later, Training Bay's recipes can call add() too.

Stamps are UTC like 2026-11-29T15:00:00Z. The clock is passed in, so tests can use a fake one.
"""

import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime

from aicity.db import with_transaction
from aicity.tasks import utc_now

NAME_MAX = 100
_STAMP_FORMAT = "%Y-%m-%dT%H:%M:%SZ"


class GroceryError(ValueError):
    """A change that isn't allowed. The message is safe to show."""


class GroceryItemNotFound(LookupError):
    """No item has that ID."""


@dataclass(frozen=True)
class GroceryItem:
    id: int
    name: str
    ticked: bool


class GroceryStore:
    """All grocery list reads and writes for one open database."""

    def __init__(
        self, conn: sqlite3.Connection, *, clock: Callable[[], datetime] = utc_now
    ) -> None:
        self._conn = conn
        self._clock = clock

    def items(self) -> list[GroceryItem]:
        rows = self._conn.execute(
            "SELECT id, name, status FROM grocery_items WHERE status <> 'cleared' "
            "ORDER BY status = 'ticked', ticked_at, id"
        ).fetchall()
        return [GroceryItem(r[0], r[1], r[2] == "ticked") for r in rows]

    def open_count(self) -> int:
        return self._conn.execute(
            "SELECT count(*) FROM grocery_items WHERE status = 'open'"
        ).fetchone()[0]

    def add(self, name: str) -> GroceryItem:
        name = name.strip() if isinstance(name, str) else ""
        if not 1 <= len(name) <= NAME_MAX:
            raise GroceryError(f"An item needs a name of 1 to {NAME_MAX} characters.")

        def work() -> int:
            existing = self._conn.execute(
                "SELECT id FROM grocery_items WHERE status <> 'cleared' "
                "AND lower(name) = lower(?) ORDER BY id LIMIT 1",
                (name,),
            ).fetchone()
            if existing:
                self._conn.execute(
                    "UPDATE grocery_items SET status = 'open', ticked_at = NULL WHERE id = ?",
                    (existing[0],),
                )
                return existing[0]
            return self._conn.execute(
                "INSERT INTO grocery_items (name, created_at) VALUES (?, ?)",
                (name, self._stamp()),
            ).lastrowid

        return self._get(with_transaction(self._conn, work, immediate=True))

    def set_ticked(self, item_id: int, ticked: bool) -> GroceryItem:
        self._listed(item_id)

        def work() -> None:
            self._conn.execute(
                "UPDATE grocery_items SET status = ?, ticked_at = ? WHERE id = ?",
                ("ticked" if ticked else "open", self._stamp() if ticked else None, item_id),
            )

        with_transaction(self._conn, work, immediate=True)
        return self._get(item_id)

    def remove(self, item_id: int) -> None:
        self._listed(item_id)
        with_transaction(self._conn, lambda: self._clear(f"id = {int(item_id)}"), immediate=True)

    def clear_ticked(self) -> int:
        """Take every ticked item off the list. Returns how many."""
        return with_transaction(
            self._conn, lambda: self._clear("status = 'ticked'"), immediate=True
        )

    # --- Helpers ----------------------------------------------------------

    def _clear(self, where: str) -> int:
        return self._conn.execute(
            "UPDATE grocery_items SET status = 'cleared', ticked_at = NULL, cleared_at = ? "
            f"WHERE status <> 'cleared' AND {where}",
            (self._stamp(),),
        ).rowcount

    def _listed(self, item_id: int) -> None:
        row = self._conn.execute(
            "SELECT status FROM grocery_items WHERE id = ?", (item_id,)
        ).fetchone()
        if row is None:
            raise GroceryItemNotFound(f"No grocery item with ID {item_id}.")
        if row[0] == "cleared":
            raise GroceryError("That item was taken off the list.")

    def _get(self, item_id: int) -> GroceryItem:
        row = self._conn.execute(
            "SELECT id, name, status FROM grocery_items WHERE id = ?", (item_id,)
        ).fetchone()
        return GroceryItem(row[0], row[1], row[2] == "ticked")

    def _stamp(self) -> str:
        now = self._clock()
        if now.tzinfo is None:
            raise ValueError("The clock must return a timezone-aware time.")
        return now.astimezone(UTC).strftime(_STAMP_FORMAT)
