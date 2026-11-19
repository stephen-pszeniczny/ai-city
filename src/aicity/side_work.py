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
from aicity.fx import latest_rate
from aicity.settings import IncomeSettings, PaySchedule
from aicity.side_work_math import (
    CURRENCIES,
    arrival_window,
    expected_cents,
    is_overdue,
    pay_period,
    rate_text,
    set_aside_cents,
    split_bonus,
    to_cad_cents,
)
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
    hundredths: int | None
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
    includes_bonus: bool = False
    bonus_cents: int | None = None
    notes: str | None = None
    deposit_id: int | None = None


MAX_NOTES = 500
_ENTRY_COLUMNS = (
    "id, worked_on, company, role, hundredths, rate_cents, currency, payment_id, archived, "
    "created_at, updated_at"
)
_PAYMENT_COLUMNS = (
    "id, kind, company, received_on, amount_cents, currency, rate, rate_date, created_at, "
    "includes_bonus, bonus_cents, notes, deposit_id, is_extra"
)
_EDITABLE = {"worked_on", "company", "role", "hundredths", "rate_cents", "currency"}


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
        hundredths=row[4],
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
        kind="extra" if row[13] else row[1],
        company=row[2],
        received_on=date.fromisoformat(row[3]),
        amount_cents=row[4],
        currency=row[5],
        rate=None if row[6] is None else Decimal(row[6]),
        rate_date=None if row[7] is None else date.fromisoformat(row[7]),
        created_at=row[8],
        includes_bonus=bool(row[9]),
        bonus_cents=row[10],
        notes=row[11],
        deposit_id=row[12],
    )


def _clean_notes(notes: str | None) -> str | None:
    if notes is None or not notes.strip():
        return None
    if len(notes.strip()) > MAX_NOTES:
        raise SideWorkError(f"Notes must be at most {MAX_NOTES} characters.")
    return notes.strip()


def _check_bonus(includes_bonus: bool, bonus_cents: int | None, amount_cents: int) -> None:
    if bonus_cents is None:
        return
    if not includes_bonus:
        raise SideWorkError("A bonus amount needs the 'includes a bonus' box ticked.")
    if not 1 <= bonus_cents <= amount_cents:
        raise SideWorkError("The bonus must be more than 0 and no more than the payment.")


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
        hundredths: int | None,
        rate_cents: int | None,
        currency: str,
    ) -> Entry:
        stamp = _stamp(self._clock())

        def work() -> int:
            return self._conn.execute(
                "INSERT INTO side_work_entries (worked_on, company, role, hundredths, rate_cents, "
                "currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    worked_on.isoformat(),
                    _clean_text(company, "Company"),
                    _clean_text(role, "Role"),
                    hundredths,
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
        includes_bonus: bool = False,
        bonus_cents: int | None = None,
        notes: str | None = None,
        deposit_id: int | None = None,
    ) -> Payment:
        if kind not in ("pay", "bonus", "extra"):
            raise SideWorkError("Payment kind must be pay, bonus or extra.")
        if kind == "pay" and not entry_ids:
            raise SideWorkError("A pay payment covers at least one entry.")
        if kind != "pay" and entry_ids:
            raise SideWorkError("A bonus or extra income isn't linked to entries.")
        _check_bonus(includes_bonus, bonus_cents, amount_cents)
        notes = _clean_notes(notes)
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
                "currency, rate, rate_date, created_at, includes_bonus, bonus_cents, notes, "
                "deposit_id, is_extra) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    "bonus" if kind == "extra" else kind,
                    _clean_text(company, "Company"),
                    received_on.isoformat(),
                    amount_cents,
                    currency,
                    None if rate is None else rate_text(rate),
                    None if rate_date is None else rate_date.isoformat(),
                    stamp,
                    int(includes_bonus),
                    bonus_cents,
                    notes,
                    deposit_id,
                    int(kind == "extra"),
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

    def edit_payment(
        self,
        payment_id: int,
        *,
        includes_bonus: bool,
        bonus_cents: int | None,
        notes: str | None,
    ) -> Payment:
        """Change a payment's bonus details and notes (never its amount or date)."""
        notes = _clean_notes(notes)

        def work() -> None:
            current = self._get_payment(payment_id)
            _check_bonus(includes_bonus, bonus_cents, current.amount_cents)
            self._conn.execute(
                "UPDATE side_work_payments SET includes_bonus = ?, bonus_cents = ?, notes = ? "
                "WHERE id = ?",
                (int(includes_bonus), bonus_cents, notes, payment_id),
            )

        with_transaction(self._conn, work, immediate=True)
        return self._get_payment(payment_id)

    def link_deposit(self, payment_id: int, deposit_id: int, *, company: str) -> Payment:
        """Mark a payment typed in by hand as proven by an imported deposit."""

        def work() -> None:
            current = self._get_payment(payment_id)
            if current.company != company:
                raise SideWorkError("That payment is from another company.")
            if current.deposit_id is not None:
                raise SideWorkConflict("That payment is already linked to a deposit.")
            self._conn.execute(
                "UPDATE side_work_payments SET deposit_id = ? WHERE id = ?",
                (deposit_id, payment_id),
            )

        with_transaction(self._conn, work, immediate=True)
        return self._get_payment(payment_id)

    @staticmethod
    def _refuse_if_settled(current: Entry, action: str) -> None:
        if current.payment_id is not None:
            raise SideWorkConflict(f"A paid entry can't be {action}.")
        if current.archived:
            raise SideWorkConflict(f"An archived entry can't be {action}.")


# --- The Side work screen ---------------------------------------------------------------


def side_work_view(
    store: SideWorkStore,
    conn: sqlite3.Connection,
    schedules: dict[str, PaySchedule],
    income: IncomeSettings,
    today: date,
) -> dict:
    """Everything the Side work screen shows, as plain JSON-ready data.

    Entries for a platform with a pay schedule are grouped by pay week; any
    others by company. Either way, entries paid separately form separate groups. Paid
    groups are valued at the payment's rate (the received day's), unpaid USD
    at the newest known rate, marked as an estimate.
    """
    payments = {p.id: p for p in store.payments()}
    latest = latest_rate(conn)
    latest_value = None if latest is None else latest[0]
    rates_pending = False

    def payment_cad(p: Payment) -> int | None:
        return to_cad_cents(p.amount_cents, p.currency, p.rate)

    buckets: dict[tuple, list[Entry]] = {}
    for e in store.entries():
        schedule = schedules.get(e.company or "")
        if schedule is None or not schedule.timed:
            # No schedule, or a company with no pay timing yet: one group per company
            # (and per payment), so one deposit can cover several sessions.
            key = ("company", e.company, e.payment_id)
        else:
            key = ("week", e.company, pay_period(e.worked_on, schedule)[0], e.payment_id)
        buckets.setdefault(key, []).append(e)

    groups = []
    still_expected = 0
    for key, entries in buckets.items():
        first = entries[0]
        schedule = schedules.get(first.company or "")
        period = window = None
        if key[0] == "week":
            period = pay_period(first.worked_on, schedule)
            window = arrival_window(period[1], schedule)
        payment = payments.get(first.payment_id) if first.payment_id else None
        rate = payment.rate if payment else latest_value

        expected_cad, partial = 0, False
        totals: dict[str, int] = {}
        for e in entries:
            amount = expected_cents(e.hundredths, e.rate_cents)
            if amount is None:
                partial = True
            else:
                totals[e.currency] = totals.get(e.currency, 0) + amount
        for currency, amount in totals.items():
            cad = to_cad_cents(amount, currency, rate)
            if cad is None:
                partial = True
                rates_pending = True
            else:
                expected_cad += cad
        if not totals:
            expected_cad = None

        if payment:
            status = "paid"
        elif window is None:
            status = "no_schedule"
        else:
            status = "overdue" if is_overdue(window, False, today) else "waiting"
        if not payment and expected_cad is not None:
            still_expected += expected_cad

        received = None if payment is None else payment_cad(payment)
        difference, bonus_cad = (None, None)
        if not partial:
            bonus_in = None
            if payment and payment.bonus_cents is not None:
                bonus_in = to_cad_cents(payment.bonus_cents, payment.currency, payment.rate)
            difference, bonus_cad = split_bonus(
                expected_cad, received, bool(payment and payment.includes_bonus), bonus_in
            )
        groups.append(
            {
                "company": first.company,
                "company_name": schedule.name if schedule else first.company,
                "schedule_id": schedule.id if schedule else None,
                "period": None if period is None else [d.isoformat() for d in period],
                "window": None if window is None else [d.isoformat() for d in window],
                "status": status,
                "entries": [_entry_json(e) for e in entries],
                "expected_cad_cents": expected_cad,
                "expected_is_partial": partial,
                "expected_is_estimate": payment is None and "USD" in totals,
                "payment": None if payment is None else _payment_json(payment, received),
                "difference_cad_cents": difference,
                "bonus_cad_cents": bonus_cad,
                "_sort": (period[0] if period else entries[-1].worked_on, first.id),
            }
        )
    groups.sort(key=lambda g: g.pop("_sort"), reverse=True)

    month_received = year_received = 0
    bonuses, extras = [], []
    for p in payments.values():
        cad = payment_cad(p)
        if p.kind == "bonus":
            bonuses.append(_payment_json(p, cad))
        elif p.kind == "extra":
            extras.append(_payment_json(p, cad))
        if cad is None:
            rates_pending = True
            continue
        if p.received_on.year == today.year:
            year_received += cad
            if p.received_on.month == today.month:
                month_received += cad
    bonuses.reverse()
    extras.reverse()

    return {
        "summary": {
            "month_received_cad_cents": month_received,
            "still_expected_cad_cents": still_expected,
            "year_received_cad_cents": year_received,
            "set_aside_cad_cents": set_aside_cents(year_received, income.tax_set_aside_percent),
            "set_aside_percent": format(income.tax_set_aside_percent.normalize(), "f"),
            "set_aside_is_placeholder": income.tax_set_aside_is_placeholder,
            "rates_pending": rates_pending,
        },
        "schedules": [{"id": s.id, "name": s.name} for s in schedules.values()],
        "groups": groups,
        "bonuses": bonuses,
        "extras": extras,
    }


def _hours_text(hundredths: int | None) -> str | None:
    if hundredths is None:
        return None
    return format((Decimal(hundredths) / 100).normalize(), "f")


def _entry_json(e: Entry) -> dict:
    return {
        "id": e.id,
        "worked_on": e.worked_on.isoformat(),
        "company": e.company,
        "role": e.role,
        "hours": _hours_text(e.hundredths),
        "hundredths": e.hundredths,
        "rate_cents": e.rate_cents,
        "currency": e.currency,
        "expected_cents": expected_cents(e.hundredths, e.rate_cents),
    }


def _payment_json(p: Payment, received_cad: int | None) -> dict:
    return {
        "id": p.id,
        "kind": p.kind,
        "company": p.company,
        "received_on": p.received_on.isoformat(),
        "amount_cents": p.amount_cents,
        "currency": p.currency,
        "rate": None if p.rate is None else rate_text(p.rate),
        "rate_date": None if p.rate_date is None else p.rate_date.isoformat(),
        "received_cad_cents": received_cad,
        "includes_bonus": p.includes_bonus,
        "bonus_cents": p.bonus_cents,
        "notes": p.notes,
        "deposit_id": p.deposit_id,
    }
