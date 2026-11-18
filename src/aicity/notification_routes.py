"""Web routes for the notification list (the shuttle and the ticker).

    GET  /api/notifications?looking=0|1     {mode, items}: active ones, oldest first.
                                            looking: the page's window has focus (kept
                                            in memory for Mac notifications, never saved)
    POST /api/notifications/{id}/seen       the shuttle has flown for it  (body: {mode})
    POST /api/notifications/{id}/dismiss    take it off the ticker        (body: {mode})

The GET only reads: notifications are made by the background reminder check
(src/aicity/reminder_loop.py), never by a page asking.

Each database numbers its notifications separately, so the same ID can exist in
Personal and Sample. The POSTs therefore carry the mode the item was shown in,
and are refused (409) if the mode has changed since: a late request can never
touch the other database's notification.

Answers: 404 no such notification, 409 no longer active or the mode changed,
422 bad input, 503 settings file missing or invalid.
"""

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import asdict
from typing import Literal

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from aicity.db import DbKind, db_path, open_database
from aicity.notifications import NotificationConflict, NotificationNotFound, NotificationStore
from aicity.settings import load_settings

router = APIRouter(prefix="/api/notifications")


class ModeChanged(Exception):
    """The request was for a different mode than the one in use now."""


class ShownIn(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    mode: Literal["sample", "personal"]


@contextmanager
def _store(
    request: Request, expected: str | None = None
) -> Iterator[tuple[NotificationStore, DbKind]]:
    """Open the current mode's database. Yields the store and the mode it opened,
    read once: a switch landing mid-request must never relabel what was read."""
    state = request.app.state
    load_settings()  # same rule as every route: no settings file, no answers (503)
    kind = DbKind(state.db_kind)
    if expected is not None and expected != kind.value:
        raise ModeChanged
    conn: sqlite3.Connection = open_database(db_path(kind), kind)
    try:
        yield NotificationStore(conn, clock=state.clock), kind
    finally:
        conn.close()


@router.get("")
def list_notifications(request: Request, looking: bool = False) -> dict:
    request.app.state.presence.report(looking)
    with _store(request) as (store, kind):
        return {"mode": kind.value, "items": [asdict(n) for n in store.list_active()]}


@router.post("/{nid}/seen")
def mark_seen(request: Request, nid: int, body: ShownIn) -> dict:
    with _store(request, body.mode) as (store, _kind):
        store.mark_seen(nid)
    return {"ok": True}


@router.post("/{nid}/dismiss")
def dismiss(request: Request, nid: int, body: ShownIn) -> dict:
    with _store(request, body.mode) as (store, _kind):
        store.dismiss(nid)
    return {"ok": True}


def register(app: FastAPI) -> None:
    """Add the notification routes and their error answers to the app."""
    app.include_router(router)

    @app.exception_handler(NotificationNotFound)
    def _not_found(_request: Request, _exc: NotificationNotFound) -> JSONResponse:
        return JSONResponse({"detail": "Notification not found."}, status_code=404)

    @app.exception_handler(NotificationConflict)
    def _conflict(_request: Request, exc: NotificationConflict) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.exception_handler(ModeChanged)
    def _mode_changed(_request: Request, _exc: ModeChanged) -> JSONResponse:
        return JSONResponse({"detail": "The mode changed; refresh."}, status_code=409)
