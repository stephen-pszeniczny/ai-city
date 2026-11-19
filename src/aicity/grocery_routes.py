"""Web routes for Mission Control's grocery list.

    GET   /api/grocery                    the list (unticked first) and how many are unticked
    POST  /api/grocery                    add an item (a name already listed returns that item)
    POST  /api/grocery/{id}/tick          tick or untick an item
    POST  /api/grocery/{id}/remove        take one item off the list
    POST  /api/grocery/clear-ticked       take every ticked item off the list

Answers: 404 no such item, 409 the item was already taken off the list, 422 bad input,
503 settings file missing or invalid (same rule as every route). Nothing is deleted.
"""

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import asdict
from typing import Annotated

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, StringConstraints

from aicity.db import db_path, open_database
from aicity.grocery import GroceryError, GroceryItemNotFound, GroceryStore
from aicity.settings import load_settings

router = APIRouter(prefix="/api/grocery")

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class NewItem(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Name


class Tick(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ticked: bool


@contextmanager
def _store(request: Request) -> Iterator[GroceryStore]:
    load_settings()  # same rule as every route: no settings file, no answers (503)
    state = request.app.state
    conn: sqlite3.Connection = open_database(db_path(state.db_kind), state.db_kind)
    try:
        yield GroceryStore(conn, clock=state.clock)
    finally:
        conn.close()


@router.get("")
def grocery_list(request: Request) -> dict:
    with _store(request) as store:
        return {"items": [asdict(i) for i in store.items()], "open": store.open_count()}


@router.post("", status_code=201)
def add_item(request: Request, body: NewItem) -> dict:
    with _store(request) as store:
        return asdict(store.add(body.name))


@router.post("/clear-ticked")
def clear_ticked(request: Request) -> dict:
    with _store(request) as store:
        return {"cleared": store.clear_ticked()}


@router.post("/{item_id}/tick")
def tick_item(request: Request, item_id: int, body: Tick) -> dict:
    with _store(request) as store:
        return asdict(store.set_ticked(item_id, body.ticked))


@router.post("/{item_id}/remove")
def remove_item(request: Request, item_id: int) -> dict:
    with _store(request) as store:
        store.remove(item_id)
        return {"removed": True}


def register(app: FastAPI) -> None:
    """Add the grocery routes and their error answers to the app."""
    app.include_router(router)

    @app.exception_handler(GroceryItemNotFound)
    def _not_found(_request: Request, _exc: GroceryItemNotFound) -> JSONResponse:
        return JSONResponse({"detail": "Item not found."}, status_code=404)

    @app.exception_handler(GroceryError)
    def _not_allowed(_request: Request, exc: GroceryError) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=409)
