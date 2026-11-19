"""The Vault's income records: statement imports, the deposits kept from them, and
main-job pay (typed in on payday, or added from a statement deposit, with optional
details typed in from the pay stub).

Only income from known sources is stored. Never: the statement file, spending
rows, balances or descriptions. Nothing here is deleted.
"""

import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, timedelta

from aicity.db import with_transaction
from aicity.side_work import MAX_NOTES
from aicity.tasks import utc_now


class IncomeError(ValueError):
    """Bad input. The message says what to fix."""


class MainJobPayNotFound(IncomeError):
    """No main-job pay has that ID."""


class MainJobPayTaken(IncomeError):
    """That pay is already confirmed (or doesn't exist)."""


@dataclass(frozen=True)
class Deposit:
    id: int
    posted_on: date
    amount_cents: int
    kind: str
    source: str
    import_id: int


@dataclass(frozen=True)
class MainJobPayRow:
    id: int
    paid_on: date
    net_cents: int
    gross_cents: int | None
    rrsp_cents: int | None
    match_cents: int | None
    notes: str | None
    deposit_id: int | None
    # Older pay checked against old statements by hand (marked once by migration 009).
    hand_checked: bool = False

    @property
    def confirmed(self) -> bool:
        """A statement deposit has confirmed this pay, or it was checked by hand."""
        return self.deposit_id is not None or self.hand_checked

    @property
    def deductions_cents(self) -> int | None:
        """Tax and other deductions: gross - net - your RRSP contribution."""
        if self.gross_cents is None:
            return None
        return self.gross_cents - self.net_cents - (self.rrsp_cents or 0)


@dataclass(frozen=True)
class StatementImport:
    id: int
    first_day: date
    last_day: date
    kept: int
    duplicates: int
    skipped: int
    spending: int
    created_at: str


def _stamp(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


class IncomeStore:
    def __init__(
        self, conn: sqlite3.Connection, *, clock: Callable[[], datetime] = utc_now
    ) -> None:
        self._conn = conn
        self._clock = clock

    # --- Reading ----------------------------------------------------------

    def existing_row_keys(self, keys: set[str]) -> set[str]:
        """Which of these statement rows were stored by an earlier import."""
        found: set[str] = set()
        ordered = sorted(keys)
        for i in range(0, len(ordered), 500):
            chunk = ordered[i : i + 500]
            marks = ", ".join("?" for _ in chunk)
            rows = self._conn.execute(
                f"SELECT row_key FROM deposits WHERE row_key IN ({marks})", chunk
            ).fetchall()
            found.update(r[0] for r in rows)
        return found

    def deposits(self) -> list[Deposit]:
        rows = self._conn.execute(
            "SELECT id, posted_on, amount_cents, kind, source, import_id FROM deposits "
            "ORDER BY posted_on, id"
        ).fetchall()
        return [Deposit(r[0], date.fromisoformat(r[1]), r[2], r[3], r[4], r[5]) for r in rows]

    def main_job_pay(self) -> list[MainJobPayRow]:
        """Every main-job pay, typed in or from a statement, oldest first (not removed ones)."""
        return self._pay_rows("")

    def unconfirmed_main_job_pay(self) -> list[MainJobPayRow]:
        """Pay typed in by hand that no statement deposit has confirmed yet."""
        return self._pay_rows("AND deposit_id IS NULL AND hand_checked_at IS NULL")

    def _pay_rows(self, more: str, args: tuple = ()) -> list[MainJobPayRow]:
        rows = self._conn.execute(
            "SELECT id, paid_on, net_cents, gross_cents, rrsp_cents, match_cents, notes, "
            "deposit_id, hand_checked_at IS NOT NULL "
            f"FROM main_job_payments WHERE archived_at IS NULL {more} "
            "ORDER BY paid_on, id",
            args,
        ).fetchall()
        return [
            MainJobPayRow(r[0], date.fromisoformat(r[1]), *r[2:8], hand_checked=bool(r[8]))
            for r in rows
        ]

    def _pay(self, pay_id: int) -> MainJobPayRow | None:
        """One pay by ID; a removed (archived) pay counts as not there."""
        found = self._pay_rows("AND id = ?", (pay_id,))
        return found[0] if found else None

    def imports(self) -> list[StatementImport]:
        rows = self._conn.execute(
            "SELECT id, first_day, last_day, kept, duplicates, skipped, spending, created_at "
            "FROM statement_imports ORDER BY id DESC"
        ).fetchall()
        return [
            StatementImport(r[0], date.fromisoformat(r[1]), date.fromisoformat(r[2]), *r[3:7], r[7])
            for r in rows
        ]

    def covers_month_before(self, today: date) -> bool:
        """Whether a stored import covers at least one day of the month before today's."""
        last_month_end = today.replace(day=1) - timedelta(days=1)
        last_month_start = last_month_end.replace(day=1)
        return any(
            i.first_day <= last_month_end and i.last_day >= last_month_start for i in self.imports()
        )

    # --- Writing (callers run these inside one transaction for an import) --

    def record_import(
        self,
        *,
        first_day: date,
        last_day: date,
        kept: int,
        duplicates: int,
        skipped: int,
        spending: int,
    ) -> int:
        return self._conn.execute(
            "INSERT INTO statement_imports (first_day, last_day, kept, duplicates, skipped, "
            "spending, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                first_day.isoformat(),
                last_day.isoformat(),
                kept,
                duplicates,
                skipped,
                spending,
                _stamp(self._clock()),
            ),
        ).lastrowid

    def add_deposit(
        self,
        *,
        posted_on: date,
        amount_cents: int,
        kind: str,
        source: str,
        row_key: str,
        import_id: int,
    ) -> Deposit:
        deposit_id = self._conn.execute(
            "INSERT INTO deposits (posted_on, amount_cents, kind, source, row_key, import_id, "
            "created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                posted_on.isoformat(),
                amount_cents,
                kind,
                source,
                row_key,
                import_id,
                _stamp(self._clock()),
            ),
        ).lastrowid
        return Deposit(deposit_id, posted_on, amount_cents, kind, source, import_id)

    def add_main_job_pay(
        self,
        *,
        paid_on: date,
        net_cents: int,
        gross_cents: int | None,
        rrsp_cents: int | None,
        match_cents: int | None,
        notes: str | None,
        deposit_id: int | None = None,
    ) -> MainJobPayRow:
        """Record one main-job pay: typed in by hand (no deposit) or from a deposit."""
        notes = _clean_notes(notes)
        _check_pay(net_cents, gross_cents, rrsp_cents)

        def work() -> int:
            return self._conn.execute(
                "INSERT INTO main_job_payments (paid_on, net_cents, gross_cents, rrsp_cents, "
                "match_cents, notes, deposit_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    paid_on.isoformat(),
                    net_cents,
                    gross_cents,
                    rrsp_cents,
                    match_cents,
                    notes,
                    deposit_id,
                    _stamp(self._clock()),
                ),
            ).lastrowid

        pay_id = with_transaction(self._conn, work, immediate=True)
        return self._pay(pay_id)

    def edit_main_job_pay(
        self,
        pay_id: int,
        *,
        paid_on: date | None,
        net_cents: int | None,
        gross_cents: int | None,
        rrsp_cents: int | None,
        match_cents: int | None,
        notes: str | None,
    ) -> MainJobPayRow:
        """Replace the stub details; change the date or net only while not yet confirmed."""
        notes = _clean_notes(notes)

        def work() -> None:
            pay = self._pay(pay_id)
            if pay is None:
                raise MainJobPayNotFound(f"No main-job pay with ID {pay_id}.")
            new_day = pay.paid_on if paid_on is None else paid_on
            new_net = pay.net_cents if net_cents is None else net_cents
            if pay.confirmed and (new_day, new_net) != (pay.paid_on, pay.net_cents):
                raise IncomeError("This pay is confirmed; its amount and date can't change.")
            _check_pay(new_net, gross_cents, rrsp_cents)
            self._conn.execute(
                "UPDATE main_job_payments SET paid_on = ?, net_cents = ?, gross_cents = ?, "
                "rrsp_cents = ?, match_cents = ?, notes = ? WHERE id = ?",
                (new_day.isoformat(), new_net, gross_cents, rrsp_cents, match_cents, notes, pay_id),
            )

        with_transaction(self._conn, work, immediate=True)
        return self._pay(pay_id)

    def archive_main_job_pay(self, pay_id: int) -> None:
        """Remove a typed-in pay (a typo or a duplicate) before a statement confirms it.

        The row stays, marked archived: it's left out of every list and total.
        """

        def work() -> None:
            pay = self._pay(pay_id)
            if pay is None:
                raise MainJobPayNotFound(f"No main-job pay with ID {pay_id}.")
            if pay.confirmed:
                raise IncomeError("This pay is confirmed, so it stays. Edit its stub details.")
            self._conn.execute(
                "UPDATE main_job_payments SET archived_at = ? WHERE id = ?",
                (_stamp(self._clock()), pay_id),
            )

        with_transaction(self._conn, work, immediate=True)

    def link_main_job_pay(self, pay_id: int, deposit: Deposit) -> MainJobPayRow:
        """A statement deposit confirms a typed-in pay: its amount wins, the typed date stays.

        The gross check isn't re-run: the statement is the truth.
        """

        def work() -> None:
            pay = self._pay(pay_id)
            if pay is None or pay.confirmed:
                raise MainJobPayTaken("That pay is already confirmed.")
            self._conn.execute(
                "UPDATE main_job_payments SET deposit_id = ?, net_cents = ? WHERE id = ?",
                (deposit.id, deposit.amount_cents, pay_id),
            )

        with_transaction(self._conn, work, immediate=True)
        return self._pay(pay_id)


def _clean_notes(notes: str | None) -> str | None:
    notes = None if notes is None or not notes.strip() else notes.strip()
    if notes is not None and len(notes) > MAX_NOTES:
        raise IncomeError(f"Notes must be at most {MAX_NOTES} characters.")
    return notes


def _check_pay(net_cents: int, gross_cents: int | None, rrsp_cents: int | None) -> None:
    if net_cents < 1:
        raise IncomeError("Net pay must be more than zero.")
    if gross_cents is not None and gross_cents < net_cents + (rrsp_cents or 0):
        raise IncomeError("Gross can't be less than net pay plus your RRSP contribution.")
