"""Web routes for Mission Control's Daily plan: the addresses the page talks to.

    GET   /api/plan/week?start=YYYY-MM-DD       a saved week (default: this week); reads only
    POST  /api/plan/week/{start}/open           the week, created from settings if it's
                                                this week or next
    POST  /api/plan/week/{start}/rebuild        refresh untouched blocks from settings
    POST  /api/plan/blocks                      add a block
    PATCH /api/plan/blocks/{id}                 change some of its fields
    POST  /api/plan/blocks/{id}/remove          remove it (kept, hidden)
    POST  /api/plan/blocks/{id}/gym             mark a gym block planned, done or skipped

    GET   /api/plan/checkin                     which week the Sunday check-in plans, and
                                                whether it's due; reads only
    POST  /api/plan/checkin/open                that week (created if needed) + usual events
    POST  /api/plan/week/{start}/grocery-day    set or clear the week's grocery day
    POST  /api/plan/week/{start}/checkin        finish the check-in (first time is kept)

Answers: 404 no such block, 409 change not allowed (past day, unsaved week, ...),
422 bad input, 503 settings file missing or invalid.

The week JSON always says whether a plan is set up ("configured": false when the
private settings have no [plan] section; nothing is created then). Sample mode
uses its own made-up plan (sample_data.SAMPLE_PLAN), never the private settings.
"""

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import asdict
from datetime import UTC, date, datetime, time, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import AfterValidator, BaseModel, ConfigDict, StringConstraints, model_validator

from aicity import sample_data
from aicity.checkin_reminder import check_checkin_reminder
from aicity.db import DbKind, db_path, open_database
from aicity.plan import BLOCK_KINDS, Block, BlockNotFound, PlanError, PlanStore, Week, monday_of
from aicity.settings import PlanSettings, load_settings

router = APIRouter(prefix="/api/plan")

# --- What the page may send ------------------------------------------------------


def _real_day(value: str) -> str:
    try:
        date.fromisoformat(value)
    except ValueError:
        raise ValueError("isn't a real calendar date") from None
    return value


Day = Annotated[str, StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}$"), AfterValidator(_real_day)]
ClockTime = Annotated[str, StringConstraints(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")]
Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Kind = Literal["work", "commute", "gym", "event", "side_work", "build", "other"]
assert set(Kind.__args__) == set(BLOCK_KINDS)


class BlockCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    week_start: Day
    day: Day
    start: ClockTime
    end: ClockTime
    title: Title
    kind: Kind

    @model_validator(mode="after")
    def ends_after_start(self) -> "BlockCreate":
        if self.end <= self.start:
            raise ValueError("end must be later than start (no blocks past midnight)")
        return self


class BlockEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    day: Day | None = None
    start: ClockTime | None = None
    end: ClockTime | None = None
    title: Title | None = None
    kind: Kind | None = None

    @model_validator(mode="after")
    def nothing_cleared(self) -> "BlockEdit":
        if any(getattr(self, name) is None for name in self.model_fields_set):
            raise ValueError("a block's fields can be changed but not cleared")
        return self


class GroceryDay(BaseModel):
    model_config = ConfigDict(extra="forbid")
    day: Day | None


class GymMark(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["planned", "done", "skipped"]


# --- Helpers -----------------------------------------------------------------------


def _week_start(value: str) -> date:
    """A week start from the address: a real date and a Monday, or 422."""
    try:
        day = date.fromisoformat(value)
    except ValueError:
        raise HTTPException(422, "A week start must be a date like 2026-11-23.") from None
    if day.weekday() != 0:
        raise HTTPException(422, "A week starts on a Monday.")
    return day


def _now(request: Request) -> datetime:
    """Local Mac time now."""
    return request.app.state.clock().astimezone()


def _today(request: Request) -> date:
    return _now(request).date()


def _rules(request: Request) -> PlanSettings | None:
    """The plan's fixed blocks: Sample mode's own, or the private settings' (None if unset)."""
    settings = load_settings()  # same rule as every route: no settings file, no answers (503)
    if request.app.state.db_kind == DbKind.SAMPLE:
        return sample_data.SAMPLE_PLAN
    return settings.plan


@contextmanager
def _open(request: Request) -> Iterator[sqlite3.Connection]:
    """Open the active database for this request and close it afterwards."""
    state = request.app.state
    conn: sqlite3.Connection = open_database(db_path(state.db_kind), state.db_kind)
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def _store(request: Request) -> Iterator[PlanStore]:
    with _open(request) as conn:
        yield PlanStore(conn, clock=request.app.state.clock)


def _block_json(block: Block) -> dict:
    data = asdict(block)
    del data["settings_key"]  # internal: how a rebuild matches rules
    return data


def _week_json(
    week_start: date, today: date, week: Week | None, *, configured: bool = True
) -> dict:
    return {
        "configured": configured,
        "week_start": week_start.isoformat(),
        "today": today.isoformat(),
        "exists": week is not None,
        "checked_in": week.checked_in if week else False,
        "grocery_day": week.grocery_day if week else None,
        "days": [
            {"day": day, "blocks": [_block_json(b) for b in blocks]}
            for day, blocks in (week.days if week else [])
        ],
    }


# --- Routes ------------------------------------------------------------------------


@router.get("/week")
def get_week(request: Request, start: str | None = None) -> dict:
    today = _today(request)
    week_start = _week_start(start) if start is not None else monday_of(today)
    rules = _rules(request)
    if rules is None:
        return _week_json(week_start, today, None, configured=False)
    with _store(request) as store:
        return _week_json(week_start, today, store.get_week(week_start))


@router.post("/week/{start}/open")
def open_week(request: Request, start: str) -> dict:
    week_start, today = _week_start(start), _today(request)
    rules = _rules(request)
    if rules is None:
        return _week_json(week_start, today, None, configured=False)
    with _store(request) as store:
        return _week_json(week_start, today, store.ensure_week(week_start, rules, today))


@router.post("/week/{start}/rebuild")
def rebuild_week(request: Request, start: str) -> dict:
    week_start, today = _week_start(start), _today(request)
    rules = _rules(request)
    if rules is None:
        return _week_json(week_start, today, None, configured=False)
    with _store(request) as store:
        return _week_json(week_start, today, store.rebuild_week(week_start, rules, today))


@router.post("/blocks", status_code=201)
def add_block(request: Request, body: BlockCreate) -> dict:
    with _store(request) as store:
        block = store.add_block(
            _week_start(body.week_start),
            date.fromisoformat(body.day),
            time.fromisoformat(body.start),
            time.fromisoformat(body.end),
            body.title,
            body.kind,
            _today(request),
        )
        return _block_json(block)


@router.patch("/blocks/{block_id}")
def edit_block(request: Request, block_id: int, body: BlockEdit) -> dict:
    fields: dict[str, object] = {}
    for name in body.model_fields_set:
        value = getattr(body, name)
        if name == "day":
            value = date.fromisoformat(value)
        elif name in ("start", "end"):
            value = time.fromisoformat(value)
        fields[name] = value
    with _store(request) as store:
        return _block_json(store.edit_block(block_id, _today(request), **fields))


@router.post("/blocks/{block_id}/remove")
def remove_block(request: Request, block_id: int) -> dict:
    with _store(request) as store:
        return _block_json(store.remove_block(block_id, _today(request)))


@router.post("/blocks/{block_id}/gym")
def mark_gym(request: Request, block_id: int, body: GymMark) -> dict:
    with _store(request) as store:
        return _block_json(store.set_gym(block_id, body.status, _today(request)))


def register(app: FastAPI) -> None:
    """Add the Daily plan routes and their error answers to the app."""
    app.include_router(router)

    @app.exception_handler(BlockNotFound)
    def _not_found(_request: Request, _exc: BlockNotFound) -> JSONResponse:
        return JSONResponse({"detail": "Block not found."}, status_code=404)

    @app.exception_handler(PlanError)
    def _not_allowed(_request: Request, exc: PlanError) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=409)


# --- The Sunday check-in -------------------------------------------------------------


def _usual_events_json(rules: PlanSettings, week_start: date) -> list[dict]:
    """The usual events as chips, each default weekday turned into a date of that week."""
    return [
        {
            "title": e.title,
            "kind": e.kind,
            "day": None if e.day is None else (week_start + timedelta(days=e.day)).isoformat(),
            "start": f"{e.start:%H:%M}",
            "end": f"{e.end:%H:%M}",
        }
        for e in rules.usual_events
    ]


@router.get("/checkin")
def checkin_status(request: Request) -> dict:
    now = _now(request)
    rules = _rules(request)
    if rules is None:
        return {
            "configured": False,
            "week_start": monday_of(now.date()).isoformat(),
            "due": False,
            "checked_in": False,
            "opens": "12:00",
            "usual_events": [],
        }
    with _store(request) as store:
        status = store.checkin_status(now, rules)
    return {
        "configured": True,
        "week_start": status.week_start.isoformat(),
        "due": status.due,
        "checked_in": status.checked_in,
        "opens": f"{rules.checkin_opens:%H:%M}",
        "usual_events": _usual_events_json(rules, status.week_start),
    }


@router.post("/checkin/open")
def open_checkin(request: Request) -> dict:
    now = _now(request)
    today = now.date()
    rules = _rules(request)
    if rules is None:
        return _week_json(monday_of(today), today, None, configured=False) | {"usual_events": []}
    with _store(request) as store:
        target = store.checkin_status(now, rules).week_start
        week = store.ensure_week(target, rules, today)
    return _week_json(target, today, week) | {"usual_events": _usual_events_json(rules, target)}


@router.post("/week/{start}/grocery-day")
def grocery_day(request: Request, start: str, body: GroceryDay) -> dict:
    week_start, today = _week_start(start), _today(request)
    day = None if body.day is None else date.fromisoformat(body.day)
    with _store(request) as store:
        return _week_json(week_start, today, store.set_grocery_day(week_start, day, today))


@router.post("/week/{start}/checkin")
def finish_checkin(request: Request, start: str) -> dict:
    week_start, now = _week_start(start), _now(request)
    rules = _rules(request)
    if rules is None:
        return _week_json(week_start, now.date(), None, configured=False)
    with _open(request) as conn:
        week = PlanStore(conn, clock=request.app.state.clock).finish_checkin(week_start)
        if request.app.state.db_kind == DbKind.PERSONAL:
            # Clear the reminder now rather than at the next background check.
            check_checkin_reminder(conn, now, rules, now.astimezone(UTC))
    return _week_json(week_start, now.date(), week)
