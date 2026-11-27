"""Web routes for Belt XP: each building's XP and level, and what the page has shown.

    GET   /api/xp                              the belt and all nine buildings
    POST  /api/xp/seen                         the page showed this level (building or "belt")
    POST  /api/xp/{building_id}/celebrated     the page played this upgrade

Answers: 204 saved, 404 no such building, 409 above the level or tier reached,
422 bad input, 503 settings file missing or invalid.

No Touch ID check, like vault_routes.badge: the answers are counts only (building IDs
and numbers), never a title, name, amount or anything else from a record, including
from the locked buildings.

The GET only reads, except that the first one in each database records the routine days
finished before Belt XP (xp.backfill_routine_finishes). The POSTs do the same first, so
their 409 checks count XP exactly as the GET does.

Routines come from the private settings; Sample mode uses its own made-up ones, and
adds a made-up head start to each building (sample_data.SAMPLE_XP_HEAD_START).
"""

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import asdict
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from aicity import sample_data
from aicity.db import DbKind, db_path, open_database
from aicity.settings import BUILDING_IDS, Routine, load_settings
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
    clock = request.app.state.clock
    backfill_routine_finishes(conn, routines, clock)
    tz = datetime.now().astimezone().tzinfo  # the Mac's own time zone
    head_start = sample_data.SAMPLE_XP_HEAD_START if kind == DbKind.SAMPLE else {}
    buildings = {
        bid: building_view(conn, bid, routines, tz, head_start=head_start.get(bid, 0))
        for bid in BUILDING_IDS
    }
    belt_seen = XpStore(conn, clock).seen(BELT_KEY)[0]
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
        belt, buildings = _views(request, conn, kind, routines)
        shown = belt.level if body.key == BELT_KEY else buildings[body.key].level
        # Seen levels only go up, so one that's too high would stick for good.
        if body.level > shown:
            raise XpError("That level hasn't been reached yet.")
        XpStore(conn, request.app.state.clock).mark_seen(body.key, body.level)
    return Response(status_code=204)


@router.post("/{building_id}/celebrated", status_code=204)
def mark_celebrated(request: Request, building_id: str, body: Celebrated) -> Response:
    if building_id not in BUILDING_IDS:
        raise HTTPException(404, "Building not found.")
    with _open(request) as (conn, kind, routines):
        _belt, buildings = _views(request, conn, kind, routines)
        XpStore(conn, request.app.state.clock).mark_celebrated(
            building_id, body.tier, current_tier=buildings[building_id].tier
        )
    return Response(status_code=204)


def register(app: FastAPI) -> None:
    """Add the XP routes and their error answers to the app."""
    app.include_router(router)

    @app.exception_handler(XpError)
    def _not_allowed(_request: Request, exc: XpError) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=409)
