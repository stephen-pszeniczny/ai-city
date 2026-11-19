"""Web routes for routines (repeating prep checklists shown in the Daily plan).

    GET   /api/plan/routines                      today's routines with their ticks; reads only
    POST  /api/plan/routines/{routine_id}/tick    tick or untick one item today

Answers: 404 no such routine, 409 not allowed (not today, doesn't run today, unknown
item), 422 bad input, 503 settings file missing or invalid.

Routines come from the private settings ([[routines]]); Sample mode uses its own
made-up ones (sample_data.SAMPLE_ROUTINES). Ticking only ever clears routine
reminders (making them is the background check's job).
"""

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, date, datetime
from typing import Annotated

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, StringConstraints

from aicity import sample_data
from aicity.db import DbKind, db_path, open_database, with_transaction
from aicity.routine_reminder import clear_routine_reminders
from aicity.routines import RoutineDay, RoutineError, RoutineNotFound, RoutineStore
from aicity.settings import Routine, load_settings

router = APIRouter(prefix="/api/plan/routines")

Item = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class Tick(BaseModel):
    model_config = ConfigDict(extra="forbid")
    item: Item
    ticked: bool


def _now(request: Request) -> datetime:
    return request.app.state.clock().astimezone()


def _routines(request: Request) -> tuple[Routine, ...]:
    settings = load_settings()  # same rule as every route: no settings file, no answers (503)
    if request.app.state.db_kind == DbKind.SAMPLE:
        return sample_data.SAMPLE_ROUTINES
    return settings.routines


@contextmanager
def _open(request: Request) -> Iterator[sqlite3.Connection]:
    state = request.app.state
    conn = open_database(db_path(state.db_kind), state.db_kind)
    try:
        yield conn
    finally:
        conn.close()


def _json(view: RoutineDay) -> dict:
    return {
        "id": view.id,
        "title": view.title,
        "shows_from": view.shows_from,
        "remind_at": view.remind_at,
        "items": [{"name": name, "ticked": ticked} for name, ticked in view.items],
        "done": view.done,
        "total": view.total,
    }


@router.get("")
def today_routines(request: Request) -> dict:
    today: date = _now(request).date()
    routines = _routines(request)
    with _open(request) as conn:
        views = RoutineStore(conn, clock=request.app.state.clock).day_view(routines, today)
    return {"today": today.isoformat(), "routines": [_json(v) for v in views]}


@router.post("/{routine_id}/tick")
def tick(request: Request, routine_id: str, body: Tick) -> dict:
    now = _now(request)
    today = now.date()
    routines = _routines(request)
    with _open(request) as conn:
        store = RoutineStore(conn, clock=request.app.state.clock)
        view = store.set_tick(routines, routine_id, body.item, body.ticked, today, today)
        # A routine just finished: its reminder goes now, not at the next background check.
        with_transaction(
            conn, lambda: clear_routine_reminders(conn, routines, today, now.astimezone(UTC))
        )
    return _json(view)


def register(app: FastAPI) -> None:
    """Add the routine routes and their error answers to the app."""
    app.include_router(router)

    @app.exception_handler(RoutineNotFound)
    def _not_found(_request: Request, _exc: RoutineNotFound) -> JSONResponse:
        return JSONResponse({"detail": "Routine not found."}, status_code=404)

    @app.exception_handler(RoutineError)
    def _not_allowed(_request: Request, exc: RoutineError) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=409)
