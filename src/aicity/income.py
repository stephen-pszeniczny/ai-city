"""The Vault's imported income: statement imports, the deposits kept from them, and
main-job pay details typed in from the pay stub.

Only income from known sources is stored. Never: the statement file, spending
rows, balances or descriptions. Nothing here is deleted.
"""

import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime

from aicity.db import with_transaction
from aicity.side_work import MAX_NOTES
from aicity.tasks import utc_now


class IncomeError(ValueError):
    """Bad input. The message says what to fix."""


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
    deposit_id: int
    posted_on: date
    net_cents: int
    gross_cents: int | None
    rrsp_cents: int | None
    match_cents: int | None
    notes: str | None

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
        """Every main-job deposit, with whatever stub details were typed in."""
        rows = self._conn.execute(
            "SELECT d.id, d.posted_on, d.amount_cents, m.gross_cents, m.rrsp_cents, "
            "m.match_cents, m.notes FROM deposits d LEFT JOIN main_job_pay m "
            "ON m.deposit_id = d.id WHERE d.kind = 'main_job' ORDER BY d.posted_on, d.id"
        ).fetchall()
        return [
            MainJobPayRow(r[0], date.fromisoformat(r[1]), r[2], r[3], r[4], r[5], r[6])
            for r in rows
        ]

    def imports(self) -> list[StatementImport]:
        rows = self._conn.execute(
            "SELECT id, first_day, last_day, kept, duplicates, skipped, spending, created_at "
            "FROM statement_imports ORDER BY id DESC"
        ).fetchall()
        return [
            StatementImport(r[0], date.fromisoformat(r[1]), date.fromisoformat(r[2]), *r[3:7], r[7])
            for r in rows
        ]

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

    def set_main_job_pay(
        self,
        deposit_id: int,
        *,
        gross_cents: int | None,
        rrsp_cents: int | None,
        match_cents: int | None,
        notes: str | None,
    ) -> MainJobPayRow:
        """Save (or replace) the stub details for one main-job deposit."""
        notes = None if notes is None or not notes.strip() else notes.strip()
        if notes is not None and len(notes) > MAX_NOTES:
            raise IncomeError(f"Notes must be at most {MAX_NOTES} characters.")

        def work() -> None:
            row = self._conn.execute(
                "SELECT kind, amount_cents FROM deposits WHERE id = ?", (deposit_id,)
            ).fetchone()
            if row is None or row[0] != "main_job":
                raise IncomeError("That isn't a main-job pay deposit.")
            if gross_cents is not None and gross_cents < row[1] + (rrsp_cents or 0):
                raise IncomeError("Gross can't be less than net pay plus your RRSP contribution.")
            self._conn.execute(
                "INSERT OR REPLACE INTO main_job_pay (deposit_id, gross_cents, rrsp_cents, "
                "match_cents, notes) VALUES (?, ?, ?, ?, ?)",
                (deposit_id, gross_cents, rrsp_cents, match_cents, notes),
            )

        if self._conn.in_transaction:
            work()
        else:
            with_transaction(self._conn, work, immediate=True)
        return next(r for r in self.main_job_pay() if r.deposit_id == deposit_id)
