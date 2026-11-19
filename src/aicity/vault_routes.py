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
from fastapi.responses import JSONResponse
from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from aicity import sample_data
from aicity.db import DbKind, db_path, open_database
from aicity.fx import rate_on, refresh_rates, save_manual_rate, valet_fetcher
from aicity.settings import load_settings
from aicity.side_work import (
    SideWorkConflict,
    SideWorkError,
    SideWorkNotFound,
    SideWorkStore,
    side_work_view,
)
from aicity.side_work_math import hours_to_hundredths, money_to_cents

KEY_HEADER = "X-Vault-Key"


# --- The lock ---------------------------------------------------------------------------


def _require_key(request: Request) -> None:
    state = request.app.state
    if state.db_kind == DbKind.PERSONAL and not state.vault_lock.allows(
        request.headers.get(KEY_HEADER)
    ):
        raise HTTPException(status_code=403, detail="Vault is locked.")


router = APIRouter(prefix="/api/vault/side-work", dependencies=[Depends(_require_key)])
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


class PaymentCreate(_Body):
    kind: Literal["pay", "bonus"]
    company: Text = None
    received_on: Day
    amount: Amount
    currency: Currency
    entry_ids: list[int] = Field(default_factory=list, max_length=500)


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
        return side_work_view(store, conn, schedules, income, _today(request))


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
        )
        return {"id": p.id, "kind": p.kind}


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
    app.include_router(unlock_router)
    app.include_router(router)

    @app.exception_handler(SideWorkNotFound)
    def _not_found(_request: Request, exc: SideWorkNotFound) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=404)

    @app.exception_handler(SideWorkConflict)
    def _conflict(_request: Request, exc: SideWorkConflict) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.exception_handler(SideWorkError)
    def _bad(_request: Request, exc: SideWorkError) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=422)
