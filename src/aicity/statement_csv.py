"""Reading a chequing statement CSV and sorting its rows.

Columns (any case, any order): date (YYYY-MM-DD), transaction, description,
amount (no sign = money in, minus = money out), balance, currency.

Errors name the line number or the missing column, never a row's content.
Only the rows the import keeps ever leave this module's callers; spending rows
are just counted.
"""

import csv
import hashlib
import io
import re
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from aicity.settings import MainJob, PaySchedule

MAX_BYTES = 2 * 1024 * 1024
MAX_ROWS = 20_000
COLUMNS = ("date", "transaction", "description", "amount", "balance", "currency")
_AMOUNT = re.compile(r"-?\d+(\.\d{1,2})?")


class StatementError(ValueError):
    """The file can't be read as a statement. The message says where."""


@dataclass(frozen=True)
class StatementRow:
    line: int
    day: date
    transaction: str
    description: str
    amount_cents: int
    balance_cents: int | None
    currency: str


@dataclass
class Classified:
    main_job: list[StatementRow] = field(default_factory=list)
    platform: dict[str, list[StatementRow]] = field(default_factory=dict)
    other_income: list[StatementRow] = field(default_factory=list)
    spending: int = 0
    other_currency: int = 0


def _cents(text: str, line: int, column: str, *, allow_blank: bool = False) -> int | None:
    text = text.strip()
    if allow_blank and not text:
        return None
    if not _AMOUNT.fullmatch(text):
        raise StatementError(
            f"line {line}: the {column} must be a plain number like 12.50 or -4.20."
        )
    return int(Decimal(text) * 100)


def read_statement(data: bytes) -> list[StatementRow]:
    """Every row of the statement, checked. Raises StatementError on any problem."""
    if len(data) > MAX_BYTES:
        raise StatementError("The file is too big for a monthly statement (over 2 MB).")
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise StatementError("The file isn't a text CSV. Download the statement as CSV.") from None

    reader = csv.reader(io.StringIO(text))
    try:
        header = next(reader)
    except StopIteration:
        raise StatementError("The file is empty.") from None
    except csv.Error:
        raise StatementError("line 1: the header can't be read.") from None
    names = [h.strip().lower() for h in header]
    missing = [c for c in COLUMNS if c not in names]
    if missing:
        raise StatementError(f"Missing column(s): {', '.join(missing)}.")
    where = {c: names.index(c) for c in COLUMNS}

    rows: list[StatementRow] = []
    try:
        for cells in reader:
            line = reader.line_num
            if not any(c.strip() for c in cells):
                continue
            if len(rows) >= MAX_ROWS:
                raise StatementError("The file has too many rows for a monthly statement.")
            if len(cells) < len(names):
                raise StatementError(f"line {line}: some columns are missing.")
            get = {c: cells[i] for c, i in where.items()}
            try:
                day = date.fromisoformat(get["date"].strip())
                if len(get["date"].strip()) != 10:
                    raise ValueError
            except ValueError:
                raise StatementError(
                    f"line {line}: the date must be a real day like 2026-03-21."
                ) from None
            rows.append(
                StatementRow(
                    line=line,
                    day=day,
                    transaction=get["transaction"].strip(),
                    description=get["description"].strip(),
                    amount_cents=_cents(get["amount"], line, "amount"),
                    balance_cents=_cents(get["balance"], line, "balance", allow_blank=True),
                    currency=get["currency"].strip().upper(),
                )
            )
    except csv.Error:
        raise StatementError(f"line {reader.line_num}: the row can't be read.") from None
    return rows


def row_key(row: StatementRow) -> str:
    """A fingerprint of the row, so importing it again is recognised (64 hex characters)."""
    parts = [
        row.day.isoformat(),
        row.transaction,
        row.description,
        str(row.amount_cents),
        "" if row.balance_cents is None else str(row.balance_cents),
        row.currency,
    ]
    return hashlib.sha256("\x1f".join(parts).encode()).hexdigest()


def classify(
    rows: list[StatementRow], main_job: MainJob | None, schedules: dict[str, PaySchedule]
) -> Classified:
    """Sort rows: main-job pay, each platform's deposits, other money in, and counts."""
    out = Classified()
    platforms = [(s.id, s.deposit_match.lower()) for s in schedules.values() if s.deposit_match]
    main_word = main_job.deposit_match.lower() if main_job else None
    for row in rows:
        if row.currency != "CAD":
            out.other_currency += 1
            continue
        if row.amount_cents < 0:
            out.spending += 1
            continue
        if row.amount_cents == 0:
            continue
        text = row.description.lower()
        if main_word and main_word in text:
            out.main_job.append(row)
            continue
        platform = next((pid for pid, word in platforms if word in text), None)
        if platform:
            out.platform.setdefault(platform, []).append(row)
        else:
            out.other_income.append(row)
    return out
