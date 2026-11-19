"""The Vault's side-work log: entries of work done and payments received.

Entries hold only the date, and optionally company, role, hours, rate and
currency. Never project, task or client details. A "pay" payment covers one
or more entries; a "bonus" covers none. Nothing is deleted: entries are
archived, and payments stay.
"""

import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from aicity.db import with_transaction
from aicity.side_work_math import CURRENCIES
from aicity.tasks import utc_now

MAX_TEXT = 80


class SideWorkError(ValueError):
    """Bad input. The message says what to fix."""


class SideWorkConflict(SideWorkError):
    """Not allowed in the entry's current state (already paid, archived)."""


class SideWorkNotFound(LookupError):
    """No such entry or payment."""


@dataclass(frozen=True)
class Entry:
    id: int
    worked_on: date
    company: str | None
    role: str | None
    minutes: int | None
    rate_cents: int | None
    currency: str
    payment_id: int | None
    archived: bool
    created_at: str
    updated_at: str


@dataclass(frozen=True)
class Payment:
    id: int
    kind: str
    company: str | None
    received_on: date
    amount_cents: int
    currency: str
    rate: Decimal | None
    rate_date: date | None
    created_at: str


_ENTRY_COLUMNS = (
    "id, worked_on, company, role, minutes, rate_cents, currency, payment_id, archived, "
    "created_at, updated_at"
)
_PAYMENT_COLUMNS = (
    "id, kind, company, received_on, amount_cents, currency, rate, rate_date, created_at"
)
_EDITABLE = {"worked_on", "company", "role", "minutes", "rate_cents", "currency"}


def _stamp(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def _clean_text(value: str | None, field: str) -> str | None:
    """Trim; blank means unknown (None)."""
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    if len(value) > MAX_TEXT:
        raise SideWorkError(f"{field} must be at most {MAX_TEXT} characters.")
    return value


def _check_currency(currency: str) -> str:
    if currency not in CURRENCIES:
        raise SideWorkError("Currency must be CAD or USD.")
    return currency


def _entry(row) -> Entry:
    return Entry(
        id=row[0],
        worked_on=date.fromisoformat(row[1]),
        company=row[2],
        role=row[3],
        minutes=row[4],
        rate_cents=row[5],
        currency=row[6],
        payment_id=row[7],
        archived=bool(row[8]),
        created_at=row[9],
        updated_at=row[10],
    )


def _payment(row) -> Payment:
    return Payment(
        id=row[0],
        kind=row[1],
        company=row[2],
        received_on=date.fromisoformat(row[3]),
        amount_cents=row[4],
        currency=row[5],
        rate=None if row[6] is None else Decimal(row[6]),
        rate_date=None if row[7] is None else date.fromisoformat(row[7]),
        created_at=row[8],
    )


def rate_text(rate: Decimal) -> str:
    """A rate as stored: plain decimal text with at least one decimal place."""
    text = format(rate, "f")
    return text if "." in text else text + ".0"


class SideWorkStore:
    """All side-work reads and writes for one open database."""

    def __init__(
        self, conn: sqlite3.Connection, *, clock: Callable[[], datetime] = utc_now
    ) -> None:
        self._conn = conn
        self._clock = clock

    # --- Reading ----------------------------------------------------------

    def entries(self, include_archived: bool = False) -> list[Entry]:
        where = "" if include_archived else "WHERE archived = 0"
        rows = self._conn.execute(
            f"SELECT {_ENTRY_COLUMNS} FROM side_work_entries {where} ORDER BY worked_on, id"
        ).fetchall()
        return [_entry(r) for r in rows]

    def payments(self) -> list[Payment]:
        rows = self._conn.execute(
            f"SELECT {_PAYMENT_COLUMNS} FROM side_work_payments ORDER BY received_on, id"
        ).fetchall()
        return [_payment(r) for r in rows]

    def _get_entry(self, entry_id: int) -> Entry:
        row = self._conn.execute(
            f"SELECT {_ENTRY_COLUMNS} FROM side_work_entries WHERE id = ?", (entry_id,)
        ).fetchone()
        if row is None:
            raise SideWorkNotFound("No such side-work entry.")
        return _entry(row)

    def _get_payment(self, payment_id: int) -> Payment:
        row = self._conn.execute(
            f"SELECT {_PAYMENT_COLUMNS} FROM side_work_payments WHERE id = ?", (payment_id,)
        ).fetchone()
        if row is None:
            raise SideWorkNotFound("No such payment.")
        return _payment(row)

    # --- Writing ----------------------------------------------------------

    def add_entry(
        self,
        *,
        worked_on: date,
        company: str | None,
        role: str | None,
        minutes: int | None,
        rate_cents: int | None,
        currency: str,
    ) -> Entry:
        stamp = _stamp(self._clock())

        def work() -> int:
            return self._conn.execute(
                "INSERT INTO side_work_entries (worked_on, company, role, minutes, rate_cents, "
                "currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    worked_on.isoformat(),
                    _clean_text(company, "Company"),
                    _clean_text(role, "Role"),
                    minutes,
                    rate_cents,
                    _check_currency(currency),
                    stamp,
                    stamp,
                ),
            ).lastrowid

        return self._get_entry(with_transaction(self._conn, work))

    def edit_entry(self, entry_id: int, **changes) -> Entry:
        unknown = set(changes) - _EDITABLE
        if unknown:
            raise SideWorkError(f"Can't change: {', '.join(sorted(unknown))}.")
        values = dict(changes)
        if "company" in values:
            values["company"] = _clean_text(values["company"], "Company")
        if "role" in values:
            values["role"] = _clean_text(values["role"], "Role")
        if "currency" in values:
            _check_currency(values["currency"])
        if "worked_on" in values:
            values["worked_on"] = values["worked_on"].isoformat()

        def work() -> None:
            current = self._get_entry(entry_id)
            self._refuse_if_settled(current, "changed")
            if not values:
                return
            sets = ", ".join(f"{k} = ?" for k in values)
            self._conn.execute(
                f"UPDATE side_work_entries SET {sets}, updated_at = ? WHERE id = ?",
                (*values.values(), _stamp(self._clock()), entry_id),
            )

        with_transaction(self._conn, work, immediate=True)
        return self._get_entry(entry_id)

    def archive_entry(self, entry_id: int) -> Entry:
        def work() -> None:
            self._refuse_if_settled(self._get_entry(entry_id), "archived")
            self._conn.execute(
                "UPDATE side_work_entries SET archived = 1, updated_at = ? WHERE id = ?",
                (_stamp(self._clock()), entry_id),
            )

        with_transaction(self._conn, work, immediate=True)
        return self._get_entry(entry_id)

    def record_payment(
        self,
        *,
        kind: str,
        company: str | None,
        received_on: date,
        amount_cents: int,
        currency: str,
        entry_ids: list[int],
        rate: Decimal | None,
        rate_date: date | None,
    ) -> Payment:
        if kind not in ("pay", "bonus"):
            raise SideWorkError("Payment kind must be pay or bonus.")
        if kind == "pay" and not entry_ids:
            raise SideWorkError("A pay payment covers at least one entry.")
        if kind == "bonus" and entry_ids:
            raise SideWorkError("A bonus isn't linked to entries.")
        if len(set(entry_ids)) != len(entry_ids):
            raise SideWorkError("An entry is listed twice.")
        _check_currency(currency)
        if (rate is None) != (rate_date is None):
            raise SideWorkError("A rate needs the day it's from.")
        stamp = _stamp(self._clock())

        def work() -> int:
            for entry_id in entry_ids:
                current = self._get_entry(entry_id)
                if current.archived:
                    raise SideWorkConflict("An archived entry can't be paid.")
                if current.payment_id is not None:
                    raise SideWorkConflict("An entry already has a payment.")
            payment_id = self._conn.execute(
                "INSERT INTO side_work_payments (kind, company, received_on, amount_cents, "
                "currency, rate, rate_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    kind,
                    _clean_text(company, "Company"),
                    received_on.isoformat(),
                    amount_cents,
                    currency,
                    None if rate is None else rate_text(rate),
                    None if rate_date is None else rate_date.isoformat(),
                    stamp,
                ),
            ).lastrowid
            for entry_id in entry_ids:
                self._conn.execute(
                    "UPDATE side_work_entries SET payment_id = ?, updated_at = ? WHERE id = ?",
                    (payment_id, stamp, entry_id),
                )
            return payment_id

        return self._get_payment(with_transaction(self._conn, work, immediate=True))

    def set_payment_rate(self, payment_id: int, rate: Decimal, rate_date: date) -> Payment:
        def work() -> None:
            self._get_payment(payment_id)
            self._conn.execute(
                "UPDATE side_work_payments SET rate = ?, rate_date = ? WHERE id = ?",
                (rate_text(rate), rate_date.isoformat(), payment_id),
            )

        with_transaction(self._conn, work, immediate=True)
        return self._get_payment(payment_id)

    @staticmethod
    def _refuse_if_settled(current: Entry, action: str) -> None:
        if current.payment_id is not None:
            raise SideWorkConflict(f"A paid entry can't be {action}.")
        if current.archived:
            raise SideWorkConflict(f"An archived entry can't be {action}.")
