"""Web routes for Belt XP: each building's XP and level, and what the page has shown.

    GET   /api/xp                              the belt and all nine buildings
    POST  /api/xp/seen                         the page showed this level (building or "belt")
    POST  /api/xp/{building_id}/celebrated     the page played this upgrade

Answers: 204 saved, 404 no such building, 409 above the level or tier reached,
422 bad input, 503 settings file missing or invalid.

No Touch ID check, like vault_routes.badge: the answers are counts only (building IDs
and numbers), never a title, name, amount or anything else from a record, including
from the locked buildings.

The GET only reads (the front door relies on no GET changing data). The routine days
finished before Belt XP are recorded when the app starts instead (backfill_at_start).
Each POST checks and saves in one transaction, so what it checked can't change first.

Routines come from the private settings; Sample mode uses its own made-up ones, and
adds a made-up head start to each building (sample_data.SAMPLE_XP_HEAD_START).
"""

import logging
import sqlite3
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import asdict
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from aicity import sample_data
from aicity.db import DatabaseError, DbKind, db_path, open_database, with_transaction
from aicity.settings import BUILDING_IDS, Routine, SettingsError, load_settings
from aicity.xp import (
    BeltXp,
    BuildingXp,
    XpError,
    XpStore,
    backfill_routine_finishes,
    belt_view,
    building_view,
)
from aicity.xp_rules import MAX_LEVEL

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/xp")

BELT_KEY = "belt"
_MAX_TIER = 10


class Seen(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    key: str
    # Which keys exist is checked here; how high the level may go, in the route.
    level: Annotated[int, Field(ge=0, le=MAX_LEVEL)]


class Celebrated(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    tier: Annotated[int, Field(ge=0, le=_MAX_TIER)]


def backfill_at_start(clock: Callable[[], datetime]) -> None:
    """Run each existing database's one-time routine backfill (main.py, at app start).

    It never creates a database. A problem is logged (by type only) and that database
    is skipped, to be tried again at the next start; the app still starts.
    """
    for kind in DbKind:
        path = db_path(kind)
        if not path.exists():
            continue
        try:
            routines = (
                sample_data.SAMPLE_ROUTINES if kind == DbKind.SAMPLE else load_settings().routines
            )
            conn = open_database(path, kind)
            try:
                backfill_routine_finishes(conn, routines, clock)
            finally:
                conn.close()
        except (SettingsError, DatabaseError, sqlite3.Error, OSError) as exc:
            log.warning(
                "Routine backfill skipped the %s database (%s).", kind.value, type(exc).__name__
            )


@contextmanager
def _open(request: Request) -> Iterator[tuple[sqlite3.Connection, DbKind, tuple[Routine, ...]]]:
    """This request's database, its mode and that mode's routines."""
    settings = load_settings()  # same rule as every route: no settings file, no answers (503)
    # Read once: a mode switch during the request must not mix one mode's routines or
    # head start with the other's database.
    kind = DbKind(request.app.state.db_kind)
    routines = sample_data.SAMPLE_ROUTINES if kind == DbKind.SAMPLE else settings.routines
    conn = open_database(db_path(kind), kind)
    try:
        yield conn, kind, routines
    finally:
        conn.close()


def _views(
    request: Request, conn: sqlite3.Connection, kind: DbKind, routines: tuple[Routine, ...]
) -> tuple[BeltXp, dict[str, BuildingXp]]:
    """The belt and every building, in BUILDING_IDS order: what the page is shown."""
    head_start = sample_data.SAMPLE_XP_HEAD_START if kind == DbKind.SAMPLE else {}
    buildings = {
        # tz None: the Mac's own zone rules for each time, daylight saving included.
        bid: building_view(conn, bid, routines, None, head_start=head_start.get(bid, 0))
        for bid in BUILDING_IDS
    }
    belt_seen = XpStore(conn, request.app.state.clock).seen(BELT_KEY)[0]
    belt = belt_view(list(buildings.values()), BUILDING_IDS, seen_level=belt_seen)
    return belt, buildings


@router.get("")
def get_xp(request: Request) -> dict:
    with _open(request) as (conn, kind, routines):
        belt, buildings = _views(request, conn, kind, routines)
    return {"belt": asdict(belt), "buildings": [asdict(b) for b in buildings.values()]}


@router.post("/seen", status_code=204)
def mark_seen(request: Request, body: Seen) -> Response:
    if body.key != BELT_KEY and body.key not in BUILDING_IDS:
        raise HTTPException(422, "Unknown key: use a building ID or 'belt'.")
    with _open(request) as (conn, kind, routines):

        def work() -> None:
            belt, buildings = _views(request, conn, kind, routines)
            shown = belt.level if body.key == BELT_KEY else buildings[body.key].level
            # Seen levels only go up, so one that's too high would stick for good.
            if body.level > shown:
                raise XpError("That level hasn't been reached yet.")
            XpStore(conn, request.app.state.clock).mark_seen(body.key, body.level)

        with_transaction(conn, work, immediate=True)
    return Response(status_code=204)


@router.post("/{building_id}/celebrated", status_code=204)
def mark_celebrated(request: Request, building_id: str, body: Celebrated) -> Response:
    if building_id not in BUILDING_IDS:
        raise HTTPException(404, "Building not found.")
    with _open(request) as (conn, kind, routines):

        def work() -> None:
            _belt, buildings = _views(request, conn, kind, routines)
            XpStore(conn, request.app.state.clock).mark_celebrated(
                building_id, body.tier, current_tier=buildings[building_id].tier
            )

        with_transaction(conn, work, immediate=True)
    return Response(status_code=204)


def register(app: FastAPI) -> None:
    """Add the XP routes and their error answers to the app."""
    app.include_router(router)

    @app.exception_handler(XpError)
    def _not_allowed(_request: Request, exc: XpError) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=409)
