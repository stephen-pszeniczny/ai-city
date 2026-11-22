"""Web routes for the Vault's Side work app.

    POST  /api/vault/unlock                          Touch ID -> {"key"} (Personal mode)
    GET   /api/vault/side-work                       the whole Side work screen
    POST  /api/vault/side-work/entries               log work
    PATCH /api/vault/side-work/entries/{id}          change an unpaid entry
    POST  /api/vault/side-work/entries/{id}/archive  hide an unpaid entry
    POST  /api/vault/side-work/payments              record pay (for entries) or a bonus
    POST  /api/vault/side-work/rates/refresh         fetch missing rates, fill pending payments
    PUT   /api/vault/side-work/rates/{day}           type a rate in by hand

In Personal mode every route but unlock needs the X-Vault-Key header from
unlock (403 "Vault is locked." without it). Sample mode needs no key, never
asks for Touch ID and never goes online.

Answers: 403 locked, 404 no such entry, 409 not allowed in its current
state (already paid or archived), 422 bad input naming the field, 503
settings file missing or invalid. GET routes never change data.
"""

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, Response
from pydantic import AfterValidator, BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from aicity import sample_data
from aicity.db import DbKind, db_path, open_database
from aicity.fx import rate_on, refresh_rates, save_manual_rate, valet_fetcher
from aicity.income import IncomeError, IncomeStore, MainJobPayNotFound
from aicity.income_view import income_view, main_job_pay_json, vault_badge
from aicity.jobs_store import JobsStore
from aicity.settings import MainJob, PaySchedule, load_settings
from aicity.side_work import (
    SideWorkConflict,
    SideWorkError,
    SideWorkNotFound,
    SideWorkStore,
    side_work_view,
)
from aicity.side_work_math import hours_to_hundredths, money_to_cents
from aicity.statement_csv import MAX_BYTES, StatementError, classify, read_statement
from aicity.statement_import import (
    ImportConflict,
    ImportExpired,
    MainJobChoice,
    NoDeposits,
    OtherChoice,
    PendingImports,
    PlatformChoice,
    build_preview,
    confirm_import,
)

KEY_HEADER = "X-Vault-Key"


# --- The lock ---------------------------------------------------------------------------


def _require_key(request: Request) -> None:
    state = request.app.state
    if state.db_kind == DbKind.PERSONAL and not state.vault_lock.allows(
        request.headers.get(KEY_HEADER)
    ):
        raise HTTPException(status_code=403, detail="Vault is locked.")


router = APIRouter(prefix="/api/vault/side-work", dependencies=[Depends(_require_key)])
statements_router = APIRouter(prefix="/api/vault/statements", dependencies=[Depends(_require_key)])
unlock_router = APIRouter(prefix="/api/vault")


# --- What the page may send -------------------------------------------------------------


def _day(value: str) -> date:
    try:
        day = date.fromisoformat(value) if len(value) == 10 else None
    except ValueError:
        day = None
    if day is None or not 2000 <= day.year <= 2100:
        raise ValueError("must be a real day like 2026-03-21")
    return day


def _hours(value: str | None) -> int | None:
    return None if value is None or not value.strip() else hours_to_hundredths(value)


def _money(value: str | None) -> int | None:
    return None if value is None or not value.strip() else money_to_cents(value)


Day = Annotated[str, AfterValidator(_day)]
Hours = Annotated[str | None, AfterValidator(_hours)]
Money = Annotated[str | None, AfterValidator(_money)]
Amount = Annotated[str, AfterValidator(money_to_cents)]
Currency = Literal["CAD", "USD"]
Text = Annotated[str | None, Field(max_length=80)]


class _Body(BaseModel):
    model_config = ConfigDict(extra="forbid")


class EntryCreate(_Body):
    worked_on: Day
    company: Text = None
    role: Text = None
    hours: Hours = None
    rate: Money = None
    currency: Currency


class EntryEdit(_Body):
    worked_on: Day | None = None
    company: Text = None
    role: Text = None
    hours: Hours = None
    rate: Money = None
    currency: Currency | None = None


Notes = Annotated[str | None, Field(max_length=500)]


class PaymentCreate(_Body):
    kind: Literal["pay", "bonus", "extra"]
    company: Text = None
    received_on: Day
    amount: Amount
    currency: Currency
    entry_ids: list[int] = Field(default_factory=list, max_length=500)
    includes_bonus: bool = False
    bonus: Money = None
    notes: Notes = None


class PaymentEdit(_Body):
    includes_bonus: bool = False
    bonus: Money = None
    notes: Notes = None


class MainJobAdd(_Body):
    paid_on: Day
    net: Amount
    gross: Money = None
    rrsp: Money = None
    match: Money = None
    notes: Notes = None


class MainJobEdit(_Body):
    paid_on: Day | None = None
    net: Money = None
    gross: Money = None
    rrsp: Money = None
    match: Money = None
    notes: Notes = None


class RateIn(_Body):
    rate: str


# --- Opening the store for one request ---------------------------------------------------


@contextmanager
def _open(request: Request) -> Iterator[tuple[SideWorkStore, sqlite3.Connection]]:
    state = request.app.state
    conn = open_database(db_path(state.db_kind), state.db_kind)
    try:
        yield SideWorkStore(conn, clock=state.clock), conn
    finally:
        conn.close()


def _sample(request: Request) -> bool:
    return request.app.state.db_kind == DbKind.SAMPLE


def _today(request: Request) -> date:
    return request.app.state.clock().astimezone().date()


def _settings_for(request: Request):
    """(pay schedules, income settings): Sample mode's own, or the private settings."""
    if _sample(request):
        return sample_data.SAMPLE_PAY_SCHEDULES, sample_data.SAMPLE_INCOME
    settings = load_settings()
    return settings.pay_schedules, settings.income


def _get_rates(request: Request, conn: sqlite3.Connection, days: set[date]) -> bool:
    """Make sure these days have rates: Bank of Canada in Personal, invented in Sample."""
    today = _today(request)
    if _sample(request):
        past = [d for d in days if d <= today]
        if past:
            sample_data.ensure_sample_rates(conn, min(past), today)
        return True
    return refresh_rates(conn, days, request.app.state.fx_fetcher, today=today)


def _fill_pending_rates(store: SideWorkStore, conn: sqlite3.Connection) -> None:
    for p in store.payments():
        if p.rate is None:
            found = rate_on(conn, p.received_on)
            if found is not None:
                store.set_payment_rate(p.id, *found)


# --- Routes ------------------------------------------------------------------------------


@unlock_router.post("/unlock")
def unlock(request: Request) -> dict[str, str | None]:
    """Touch ID once per app session. Sample mode has nothing to lock."""
    if _sample(request):
        return {"key": None}
    return {"key": request.app.state.vault_lock.unlock()}


@router.get("")
def get_side_work(request: Request) -> dict:
    schedules, income = _settings_for(request)
    with _open(request) as (store, conn):
        view = side_work_view(store, conn, schedules, income, _today(request))
        return view | {"active_platforms": _active_platforms(request, conn, schedules)}


def _active_platforms(request: Request, conn: sqlite3.Connection, schedules) -> list[str]:
    """Opportunity Office platforms with an active project, offered as companies.

    Names only; one whose id is already a pay schedule is left out (it's in the list).
    """
    if _sample(request):
        jobs = sample_data.SAMPLE_JOBS
    else:
        jobs = load_settings().jobs
        if jobs is None:
            return []
    known = set(schedules)  # pay schedules are keyed by id
    names = JobsStore(conn, jobs, clock=request.app.state.clock).active_platform_names()
    ids = {p.name: p.id for p in jobs.platforms}
    return [n for n in names if ids[n] not in known]


@router.post("/entries", status_code=201)
def create_entry(request: Request, body: EntryCreate) -> dict:
    with _open(request) as (store, _conn):
        e = store.add_entry(
            worked_on=body.worked_on,
            company=body.company,
            role=body.role,
            hundredths=body.hours,
            rate_cents=body.rate,
            currency=body.currency,
        )
        return _entry_out(e)


@router.patch("/entries/{entry_id}")
def edit_entry(request: Request, entry_id: int, body: EntryEdit) -> dict:
    names = {"hours": "hundredths", "rate": "rate_cents"}
    changes = {names.get(k, k): getattr(body, k) for k in body.model_fields_set}
    if changes.get("worked_on", 0) is None or changes.get("currency", "") is None:
        raise SideWorkError("Date and currency can't be cleared.")
    with _open(request) as (store, _conn):
        return _entry_out(store.edit_entry(entry_id, **changes))


@router.post("/entries/{entry_id}/archive")
def archive_entry(request: Request, entry_id: int) -> dict:
    with _open(request) as (store, _conn):
        return _entry_out(store.archive_entry(entry_id))


@router.post("/payments", status_code=201)
def create_payment(request: Request, body: PaymentCreate) -> dict:
    with _open(request) as (store, conn):
        _get_rates(request, conn, {body.received_on})
        found = rate_on(conn, body.received_on)
        p = store.record_payment(
            kind=body.kind,
            company=body.company,
            received_on=body.received_on,
            amount_cents=body.amount,
            currency=body.currency,
            entry_ids=body.entry_ids,
            rate=None if found is None else found[0],
            rate_date=None if found is None else found[1],
            includes_bonus=body.includes_bonus,
            bonus_cents=body.bonus,
            notes=body.notes,
        )
        return {"id": p.id, "kind": p.kind}


@router.patch("/payments/{payment_id}")
def edit_payment(request: Request, payment_id: int, body: PaymentEdit) -> dict:
    """Change a payment's bonus box, bonus amount and notes (never its amount)."""
    with _open(request) as (store, _conn):
        p = store.edit_payment(
            payment_id, includes_bonus=body.includes_bonus, bonus_cents=body.bonus, notes=body.notes
        )
        return {
            "id": p.id,
            "includes_bonus": p.includes_bonus,
            "bonus_cents": p.bonus_cents,
            "notes": p.notes,
        }


@router.post("/rates/refresh")
def refresh(request: Request) -> dict[str, bool]:
    """Fetch the rates still missing (pending payments and today), then fill payments."""
    with _open(request) as (store, conn):
        days = {p.received_on for p in store.payments() if p.rate is None}
        ok = _get_rates(request, conn, days | {_today(request)})
        _fill_pending_rates(store, conn)
        return {"ok": ok}


@router.put("/rates/{day}")
def put_rate(request: Request, day: str, body: RateIn) -> dict[str, str]:
    try:
        when = _day(day)
        rate = Decimal(body.rate.strip())
    except (ValueError, InvalidOperation):
        raise SideWorkError("Rate and day must be numbers like 1.3725 and 2026-03-21.") from None
    with _open(request) as (store, conn):
        try:
            save_manual_rate(conn, when, rate)
        except ValueError as exc:
            raise SideWorkError(str(exc)) from None
        _fill_pending_rates(store, conn)
    return {"day": when.isoformat(), "rate": body.rate.strip()}


# --- Statements -----------------------------------------------------------------------


def _sources(request: Request) -> tuple[dict[str, PaySchedule], MainJob | None]:
    """(pay schedules, main job): Sample mode's own, or the private settings."""
    if _sample(request):
        return sample_data.SAMPLE_PAY_SCHEDULES, sample_data.SAMPLE_MAIN_JOB
    settings = load_settings()
    return settings.pay_schedules, settings.main_job


def _preview(request: Request, data: bytes) -> dict:
    rows = read_statement(data)
    schedules, main_job = _sources(request)
    classified = classify(rows, main_job, schedules)
    with _open(request) as (side, conn):
        days = {r.day for rs in classified.platform.values() for r in rs}
        if days:
            _get_rates(request, conn, days)
        income = IncomeStore(conn, clock=request.app.state.clock)
        pending, body = build_preview(
            conn,
            side,
            income,
            rows,
            classified,
            schedules,
            request.app.state.db_kind,
            request.app.state.clock(),
        )
    body["token"] = request.app.state.pending_imports.put(pending)
    return body


@statements_router.post("/preview")
async def preview_statement(request: Request) -> dict:
    """Read a statement CSV (the raw request body) and propose; nothing is stored."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="The file is too big (over 2 MB).")
    data = await request.body()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="The file is too big (over 2 MB).")
    return await run_in_threadpool(_preview, request, data)


class MainJobIn(_Body):
    ref: str
    action: Literal["new", "link", "skip"] = "new"
    pay_id: int | None = None
    gross: Money = None
    rrsp: Money = None
    match: Money = None
    notes: Notes = None


class PlatformIn(_Body):
    ref: str
    action: Literal["week", "bonus", "link", "skip"]
    week_start: Day | None = None
    payment_id: int | None = None
    includes_bonus: bool = False
    bonus: Money = None
    notes: Notes = None


class OtherIn(_Body):
    ref: str
    action: Literal["add", "skip"]
    company: Text = None
    notes: Notes = None


class ConfirmIn(_Body):
    token: str
    main_job: list[MainJobIn] = Field(default_factory=list, max_length=2000)
    platform: list[PlatformIn] = Field(default_factory=list, max_length=2000)
    other_income: list[OtherIn] = Field(default_factory=list, max_length=2000)


@statements_router.post("/confirm")
def confirm_statement(request: Request, body: ConfirmIn) -> dict:
    pending_imports = request.app.state.pending_imports
    pending = pending_imports.get(body.token, request.app.state.db_kind)
    schedules, _main_job = _sources(request)
    with _open(request) as (side, conn):
        result = confirm_import(
            conn,
            side,
            IncomeStore(conn, clock=request.app.state.clock),
            pending,
            schedules,
            [
                MainJobChoice(m.ref, m.action, m.pay_id, m.gross, m.rrsp, m.match, m.notes)
                for m in body.main_job
            ],
            [
                PlatformChoice(
                    p.ref, p.action, p.week_start, p.payment_id, p.includes_bonus, p.bonus, p.notes
                )
                for p in body.platform
            ],
            [OtherChoice(o.ref, o.action, o.company, o.notes) for o in body.other_income],
        )
    pending_imports.discard(body.token)
    return result


income_router = APIRouter(prefix="/api/vault/income", dependencies=[Depends(_require_key)])


def _goal_cents(request: Request) -> int:
    if _sample(request):
        return sample_data.SAMPLE_GOAL_CENTS
    return load_settings().goals.monthly_income_cents


@income_router.get("")
def get_income(request: Request) -> dict:
    schedules, income = _settings_for(request)
    _schedules, main_job = _sources(request)
    goal = _goal_cents(request)
    with _open(request) as (side, conn):
        return income_view(
            conn,
            side,
            IncomeStore(conn, clock=request.app.state.clock),
            goal,
            income,
            schedules,
            main_job.name if main_job else None,
            _today(request),
            # Sample always says "Main job"; Personal uses the main job's own name.
            main_job_label=main_job.name if (main_job and not _sample(request)) else "Main job",
        )


@income_router.post("/main-job", status_code=201)
def add_main_job(request: Request, body: MainJobAdd) -> dict:
    """Main-job pay typed in on payday ("not yet confirmed" until a statement confirms it)."""
    with _open(request) as (_side, conn):
        row = IncomeStore(conn, clock=request.app.state.clock).add_main_job_pay(
            paid_on=body.paid_on,
            net_cents=body.net,
            gross_cents=body.gross,
            rrsp_cents=body.rrsp,
            match_cents=body.match,
            notes=body.notes,
        )
        return main_job_pay_json(row)


@income_router.patch("/main-job/{pay_id}")
def edit_main_job(request: Request, pay_id: int, body: MainJobEdit) -> dict:
    """Replace a main-job pay's stub details; date and net change only before confirmation."""
    with _open(request) as (_side, conn):
        row = IncomeStore(conn, clock=request.app.state.clock).edit_main_job_pay(
            pay_id,
            paid_on=body.paid_on,
            net_cents=body.net,
            gross_cents=body.gross,
            rrsp_cents=body.rrsp,
            match_cents=body.match,
            notes=body.notes,
        )
        return main_job_pay_json(row)


@income_router.post("/main-job/{pay_id}/archive")
def archive_main_job(request: Request, pay_id: int) -> dict[str, bool]:
    """Remove a typed-in pay (a typo or a duplicate) that no statement has confirmed."""
    with _open(request) as (_side, conn):
        IncomeStore(conn, clock=request.app.state.clock).archive_main_job_pay(pay_id)
    return {"archived": True}


@unlock_router.get("/badge")
def badge(request: Request) -> dict[str, str | None]:
    """The Vault's belt badge. No Touch ID needed: counts only, never amounts."""
    schedules, income = _settings_for(request)
    with _open(request) as (side, conn):
        return {
            "text": vault_badge(
                side,
                IncomeStore(conn, clock=request.app.state.clock),
                schedules,
                _today(request),
                income.statement_due_day,
            )
        }


@statements_router.get("/sample.csv")
def sample_statement(request: Request) -> Response:
    """Sample mode's made-up statement, for trying the import. Not offered in Personal."""
    if not _sample(request):
        raise HTTPException(status_code=404, detail="Only in Sample mode.")
    with _open(request) as (side, conn):
        body = sample_data.build_sample_statement(conn, side, _today(request))
    return Response(body, media_type="text/csv")


@statements_router.get("")
def list_statements(request: Request) -> list[dict]:
    with _open(request) as (_side, conn):
        return [
            {
                "id": i.id,
                "first_day": i.first_day.isoformat(),
                "last_day": i.last_day.isoformat(),
                "kept": i.kept,
                "duplicates": i.duplicates,
                "skipped": i.skipped,
                "spending": i.spending,
                "created_at": i.created_at,
            }
            for i in IncomeStore(conn).imports()
        ]


def _entry_out(e) -> dict:
    return {
        "id": e.id,
        "worked_on": e.worked_on.isoformat(),
        "company": e.company,
        "role": e.role,
        "hundredths": e.hundredths,
        "rate_cents": e.rate_cents,
        "currency": e.currency,
        "payment_id": e.payment_id,
        "archived": e.archived,
    }


def register(app: FastAPI) -> None:
    app.state.fx_fetcher = valet_fetcher
    app.state.pending_imports = PendingImports(lambda: app.state.clock())
    app.include_router(unlock_router)
    app.include_router(router)
    app.include_router(statements_router)
    app.include_router(income_router)

    @app.exception_handler(StatementError)
    def _statement(_request: Request, exc: StatementError) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.exception_handler(NoDeposits)
    def _no_deposits(_request: Request, exc: NoDeposits) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.exception_handler(MainJobPayNotFound)
    def _no_pay(_request: Request, exc: MainJobPayNotFound) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=404)

    @app.exception_handler(IncomeError)
    def _income(_request: Request, exc: IncomeError) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.exception_handler(ImportExpired)
    def _expired(_request: Request, exc: ImportExpired) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.exception_handler(ImportConflict)
    def _stale(_request: Request, exc: ImportConflict) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.exception_handler(SideWorkNotFound)
    def _not_found(_request: Request, exc: SideWorkNotFound) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=404)

    @app.exception_handler(SideWorkConflict)
    def _conflict(_request: Request, exc: SideWorkConflict) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.exception_handler(SideWorkError)
    def _bad(_request: Request, exc: SideWorkError) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=422)
