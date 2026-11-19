"""The statement import: preview (propose, store nothing) and confirm (store what
Steve decided, all at once).

A preview's parsed rows wait in memory under a random token for 15 minutes.
They're dropped on confirm, on a mode switch, or when the app restarts. Rows
leave this module only as day + amount + an opaque ref: never a description.
"""

import hashlib
import secrets
import sqlite3
import threading
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

from aicity.db import DbKind, with_transaction
from aicity.fx import rate_on
from aicity.income import IncomeStore, MainJobPayTaken
from aicity.income_match import (
    WINDOW_SLACK_DAYS,
    HandPayment,
    OpenWeek,
    Proposal,
    TypedPay,
    propose,
    propose_main_job,
)
from aicity.settings import PaySchedule
from aicity.side_work import SideWorkConflict, SideWorkError, SideWorkStore
from aicity.side_work_math import arrival_window, expected_cents, pay_period, to_cad_cents
from aicity.statement_csv import Classified, StatementRow, row_key

PENDING_MINUTES = 15


class ImportExpired(Exception):
    """The preview is gone (used, too old, or dropped by a mode switch)."""


class ImportConflict(Exception):
    """Something changed since the preview (a week got paid, a row got imported)."""


class NoDeposits(ValueError):
    """The file has no money coming in at all."""


@dataclass
class Pending:
    kind: DbKind
    created: datetime
    rows: dict[str, StatementRow]  # ref -> row (new rows only)
    main_job: list[str]
    platform: dict[str, str]  # ref -> schedule id
    other_income: list[str]
    first_day: date
    last_day: date
    duplicates: int
    spending: int
    other_currency: int
    keys: dict[str, str] = field(default_factory=dict)  # ref -> row_key


class PendingImports:
    def __init__(self, clock: Callable[[], datetime]) -> None:
        self._clock = clock
        self._items: dict[str, Pending] = {}
        self._lock = threading.Lock()

    def put(self, pending: Pending) -> str:
        token = secrets.token_urlsafe(16)
        with self._lock:
            self._items[token] = pending
        return token

    def get(self, token: str, kind: DbKind) -> Pending:
        with self._lock:
            pending = self._items.get(token)
            if pending is None or pending.kind != kind:
                raise ImportExpired("That preview is gone. Upload the statement again.")
            if self._clock() - pending.created > timedelta(minutes=PENDING_MINUTES):
                del self._items[token]
                raise ImportExpired("That preview is over 15 minutes old. Upload it again.")
            return pending

    def discard(self, token: str) -> None:
        with self._lock:
            self._items.pop(token, None)

    def clear(self) -> None:
        with self._lock:
            self._items.clear()


# --- What's still open --------------------------------------------------------------------


def open_weeks(store: SideWorkStore, schedules: dict[str, PaySchedule]) -> list[OpenWeek]:
    """Unpaid pay weeks of platforms with a schedule, with their entries and expected pay."""
    weeks: dict[tuple[str, date], dict] = {}
    for e in store.entries():
        schedule = schedules.get(e.company or "")
        if schedule is None or e.payment_id is not None:
            continue
        start, end = pay_period(e.worked_on, schedule)
        w = weeks.setdefault(
            (schedule.id, start),
            {"window": arrival_window(end, schedule), "ids": [], "exp": {}, "partial": False},
        )
        w["ids"].append(e.id)
        amount = expected_cents(e.hundredths, e.rate_cents)
        if amount is None:
            w["partial"] = True
        else:
            w["exp"][e.currency] = w["exp"].get(e.currency, 0) + amount
    return [
        OpenWeek(sid, start, w["window"], w["ids"], w["exp"], w["partial"])
        for (sid, start), w in sorted(weeks.items(), key=lambda kv: kv[0][1])
    ]


def hand_payments(store: SideWorkStore, schedules: dict[str, PaySchedule]) -> list[HandPayment]:
    """Payments typed in by hand (not yet proven by a deposit) for scheduled platforms."""
    out = []
    for p in store.payments():
        if p.deposit_id is not None or p.company not in schedules:
            continue
        cad = to_cad_cents(p.amount_cents, p.currency, p.rate)
        if cad is not None:
            out.append(HandPayment(p.id, p.company, p.received_on, cad))
    return out


# --- Preview ------------------------------------------------------------------------------


def build_preview(
    conn: sqlite3.Connection,
    side: SideWorkStore,
    income: IncomeStore,
    rows: list[StatementRow],
    classified: Classified,
    schedules: dict[str, PaySchedule],
    kind: DbKind,
    now: datetime,
) -> tuple[Pending, dict]:
    """Proposals for the review screen, and the rows to keep waiting for confirm."""
    incoming = classified.main_job + classified.other_income
    for platform_rows in classified.platform.values():
        incoming += platform_rows
    if not incoming:
        raise NoDeposits("No deposits found. Is this the chequing statement?")

    keys: dict[int, str] = {}
    seen_blank: dict[str, int] = {}
    for r in sorted(incoming, key=lambda r: r.line):
        base = row_key(r)
        if r.balance_cents is None:
            # Without a balance, two identical rows (two equal deposits on one day)
            # would share a key; number them in file order so both are kept, and a
            # re-import of the same file numbers them the same way.
            n = seen_blank.get(base, 0)
            seen_blank[base] = n + 1
            if n:
                base = hashlib.sha256(f"{base}#{n}".encode()).hexdigest()
        keys[id(r)] = base
    existing = income.existing_row_keys(set(keys.values()))
    seen: set[str] = set()
    duplicates = 0

    def fresh(r: StatementRow) -> bool:
        nonlocal duplicates
        k = keys[id(r)]
        if k in existing or k in seen:
            duplicates += 1
            return False
        seen.add(k)
        return True

    ref = {}
    main = [r for r in classified.main_job if fresh(r)]
    platform = {sid: [r for r in rs if fresh(r)] for sid, rs in classified.platform.items()}
    other = [r for r in classified.other_income if fresh(r)]
    for r in main + other + [r for rs in platform.values() for r in rs]:
        ref[id(r)] = f"r{r.line}"

    weeks = open_weeks(side, schedules)
    proposals = propose(
        {sid: rs for sid, rs in platform.items() if rs},
        weeks,
        hand_payments(side, schedules),
        lambda d: found[0] if (found := rate_on(conn, d)) else None,
    )
    hand = {p.id: p for p in side.payments()}
    typed = income.unconfirmed_main_job_pay()
    typed_by_id = {t.id: t for t in typed}
    main_proposals = {
        id(mp.row): mp
        for mp in propose_main_job(main, [TypedPay(t.id, t.paid_on, t.net_cents) for t in typed])
    }

    def main_json(r: StatementRow) -> dict:
        mp = main_proposals[id(r)]
        pay = typed_by_id.get(mp.pay_id) if mp.pay_id is not None else None
        return brief(r) | {
            "proposal": {
                "kind": mp.kind,
                "pay_id": mp.pay_id,
                "pay": None
                if pay is None
                else {"paid_on": pay.paid_on.isoformat(), "net_cents": pay.net_cents},
            }
        }

    def proposal_json(p: Proposal) -> dict:
        out = {
            "kind": p.kind,
            "week_start": None if p.week_start is None else p.week_start.isoformat(),
            "payment_id": p.payment_id,
            "check_amount": p.check_amount,
        }
        if p.payment_id in hand:
            h = hand[p.payment_id]
            out["payment"] = {
                "received_on": h.received_on.isoformat(),
                "amount_cents": h.amount_cents,
                "currency": h.currency,
            }
        return out

    all_days = [r.day for r in rows]
    pending = Pending(
        kind=kind,
        created=now,
        rows={ref[id(r)]: r for r in main + other + [r for rs in platform.values() for r in rs]},
        main_job=[ref[id(r)] for r in main],
        platform={ref[id(r)]: sid for sid, rs in platform.items() for r in rs},
        other_income=[ref[id(r)] for r in other],
        first_day=min(all_days),
        last_day=max(all_days),
        duplicates=duplicates,
        spending=classified.spending,
        other_currency=classified.other_currency,
        keys={
            ref[id(r)]: keys[id(r)]
            for r in main + other + [r for rs in platform.values() for r in rs]
        },
    )

    def brief(r: StatementRow) -> dict:
        return {"ref": ref[id(r)], "day": r.day.isoformat(), "amount_cents": r.amount_cents}

    body = {
        "first_day": pending.first_day.isoformat(),
        "last_day": pending.last_day.isoformat(),
        "main_job": [main_json(r) for r in main],
        "typed_pay": [
            {"id": t.id, "paid_on": t.paid_on.isoformat(), "net_cents": t.net_cents} for t in typed
        ],
        "platform": [
            brief(p.row)
            | {"schedule_id": pending.platform[ref[id(p.row)]], "proposal": proposal_json(p)}
            for p in sorted(proposals, key=lambda p: (p.row.day, p.row.line))
        ],
        "other_income": [brief(r) for r in other],
        "hand_payments": [
            {
                "id": p.id,
                "schedule_id": p.company,
                "received_on": p.received_on.isoformat(),
                "amount_cents": p.amount_cents,
                "currency": p.currency,
            }
            for p in side.payments()
            if p.deposit_id is None and p.company in schedules
        ],
        "weeks": [
            {
                "schedule_id": w.schedule_id,
                "start": w.start.isoformat(),
                "window": [d.isoformat() for d in w.window],
            }
            for w in weeks
        ],
        "already_imported": duplicates,
        "spending": classified.spending,
        "other_currency": classified.other_currency,
    }
    return pending, body


# --- Confirm ------------------------------------------------------------------------------


@dataclass(frozen=True)
class MainJobChoice:
    ref: str
    action: str  # new | link | skip
    pay_id: int | None
    gross_cents: int | None
    rrsp_cents: int | None
    match_cents: int | None
    notes: str | None


@dataclass(frozen=True)
class PlatformChoice:
    ref: str
    action: str  # week | bonus | link | skip
    week_start: date | None
    payment_id: int | None
    includes_bonus: bool
    bonus_cents: int | None
    notes: str | None


@dataclass(frozen=True)
class OtherChoice:
    ref: str
    action: str  # add | skip
    company: str | None
    notes: str | None


def confirm_import(
    conn: sqlite3.Connection,
    side: SideWorkStore,
    income: IncomeStore,
    pending: Pending,
    schedules: dict[str, PaySchedule],
    main_choices: list[MainJobChoice],
    platform_choices: list[PlatformChoice],
    other_choices: list[OtherChoice],
) -> dict:
    """Store everything decided, in one transaction. Raises ImportConflict if stale."""
    by_ref_platform = {c.ref: c for c in platform_choices}
    if set(by_ref_platform) != set(pending.platform):
        raise SideWorkError("Decide every platform deposit (week, bonus, link or skip).")
    for c in platform_choices:
        if c.action != "week" and (c.includes_bonus or c.bonus_cents is not None):
            raise SideWorkError("A bonus amount only goes with a week's pay.")
    main_by_ref = {c.ref: c for c in main_choices}
    other_by_ref = {c.ref: c for c in other_choices}
    unknown = (set(main_by_ref) - set(pending.main_job)) | (
        set(other_by_ref) - set(pending.other_income)
    )
    if unknown:
        raise SideWorkError("Some decisions don't belong to this preview.")
    linked = [c.pay_id for c in main_choices if c.action == "link"]
    if None in linked:
        raise SideWorkError("Pick which typed-in pay this deposit confirms.")
    if len(linked) != len(set(linked)):
        raise SideWorkError("One typed-in pay can only be confirmed by one deposit.")

    def work() -> dict:
        if income.existing_row_keys(set(pending.keys.values())):
            raise ImportConflict("Part of this statement was imported meanwhile. Upload it again.")
        kept = skipped = 0
        import_id = income.record_import(
            first_day=pending.first_day,
            last_day=pending.last_day,
            kept=0,
            duplicates=pending.duplicates,
            skipped=0,
            spending=pending.spending,
        )

        def deposit(ref: str, kind: str, source: str):
            nonlocal kept
            kept += 1
            r = pending.rows[ref]
            return income.add_deposit(
                posted_on=r.day,
                amount_cents=r.amount_cents,
                kind=kind,
                source=source,
                row_key=pending.keys[ref],
                import_id=import_id,
            )

        for ref in pending.main_job:
            c = main_by_ref.get(ref)
            action = c.action if c else "new"
            if action == "skip":
                skipped += 1
                continue
            d = deposit(ref, "main_job", "main_job")
            if action == "link":
                try:
                    income.link_main_job_pay(c.pay_id, d)
                except MainJobPayTaken:
                    raise ImportConflict(
                        "That pay was confirmed meanwhile. Upload the statement again."
                    ) from None
            elif action == "new":
                income.add_main_job_pay(
                    paid_on=d.posted_on,
                    net_cents=d.amount_cents,
                    gross_cents=c.gross_cents if c else None,
                    rrsp_cents=c.rrsp_cents if c else None,
                    match_cents=c.match_cents if c else None,
                    notes=c.notes if c else None,
                    deposit_id=d.id,
                )
            else:
                raise SideWorkError("Each main-job deposit is new, link or skip.")

        weeks = {(w.schedule_id, w.start): w for w in open_weeks(side, schedules)}
        for ref, sid in pending.platform.items():
            c = by_ref_platform[ref]
            r = pending.rows[ref]
            if c.action == "skip":
                skipped += 1
                continue
            found = rate_on(conn, r.day)
            rate, rate_day = (found[0], found[1]) if found else (None, None)
            extra = {
                "includes_bonus": c.includes_bonus,
                "bonus_cents": c.bonus_cents,
                "notes": c.notes,
            }
            if c.action == "week":
                week = weeks.pop((sid, c.week_start), None)
                if week is None:
                    raise ImportConflict("That week isn't waiting for pay any more. Upload again.")
                if r.day < week.window[0] - timedelta(days=WINDOW_SLACK_DAYS):
                    raise SideWorkError(
                        "That week's pay couldn't have landed yet on that day. "
                        "Pick an earlier week, or link it to a payment you typed in."
                    )
                d = deposit(ref, "side_work", sid)
                side.record_payment(
                    kind="pay",
                    company=sid,
                    received_on=r.day,
                    amount_cents=r.amount_cents,
                    currency="CAD",
                    entry_ids=week.entry_ids,
                    rate=rate,
                    rate_date=rate_day,
                    deposit_id=d.id,
                    **extra,
                )
            elif c.action == "bonus":
                d = deposit(ref, "side_work", sid)
                side.record_payment(
                    kind="bonus",
                    company=sid,
                    received_on=r.day,
                    amount_cents=r.amount_cents,
                    currency="CAD",
                    entry_ids=[],
                    rate=rate,
                    rate_date=rate_day,
                    deposit_id=d.id,
                    notes=c.notes,
                )
            elif c.action == "link":
                d = deposit(ref, "side_work", sid)
                side.link_deposit(c.payment_id, d.id, company=sid)
            else:
                raise SideWorkError("Each platform deposit is a week, bonus, link or skip.")

        for ref in pending.other_income:
            c = other_by_ref.get(ref)
            if c is None or c.action == "skip":
                skipped += 1
                continue
            company = (c.company or "").strip() or "Other"
            r = pending.rows[ref]
            d = deposit(ref, "side_work", company[:80])
            side.record_payment(
                kind="extra",
                company=company,
                received_on=r.day,
                amount_cents=r.amount_cents,
                currency="CAD",
                entry_ids=[],
                rate=None,
                rate_date=None,
                deposit_id=d.id,
                notes=c.notes,
            )

        conn.execute(
            "UPDATE statement_imports SET kept = ?, skipped = ? WHERE id = ?",
            (kept, skipped, import_id),
        )
        return {
            "import_id": import_id,
            "kept": kept,
            "duplicates": pending.duplicates,
            "skipped": skipped,
        }

    try:
        return with_transaction(conn, work, immediate=True)
    except SideWorkConflict as exc:
        raise ImportConflict(str(exc)) from None
