"""Web routes for City Hall's to-do list: the addresses the page talks to.

    GET   /api/tasks?status=open|done|archived|all   list tasks (default: open)
    POST  /api/tasks                                 create a task
    GET   /api/tasks/{id}                            one task
    PATCH /api/tasks/{id}                            change some of its fields
    POST  /api/tasks/{id}/complete | reopen | archive
    GET   /api/tasks/{id}/history                    every change, oldest first

There is no DELETE: "delete" in the app means archive, and archived tasks
can be reopened. GET routes never change data (a test checks every one).

Answers: 404 no such task, 409 change not allowed in the task's current
state, 422 bad input, 503 settings file missing or invalid.

Which database is used comes from app.state.db_kind. Until the Personal /
Sample switch is built it's always the Sample database.
"""

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import asdict
from typing import Annotated, Literal

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, StringConstraints, model_validator

from aicity.db import db_path, open_database
from aicity.settings import SettingsError, load_settings
from aicity.tasks import LIST_FILTERS, TaskConflict, TaskError, TaskNotFound, TaskStore

router = APIRouter(prefix="/api/tasks")

# --- What the page may send ------------------------------------------------------
# Formats are checked here for a clear answer; the database checks real dates
# (e.g. refuses 2026-02-30) as a second line of defence.

Title = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Notes = Annotated[str, StringConstraints(max_length=5000)]
Category = Literal["work", "side_work", "personal", "city"]
GoalDate = Annotated[str, StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}$")]
ReminderAt = Annotated[str, StringConstraints(pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")]
ListFilter = Literal["open", "done", "archived", "all"]
assert set(ListFilter.__args__) == set(LIST_FILTERS)


class TaskCreate(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    title: Title
    category: Category
    notes: Notes = ""
    goal_date: GoalDate | None = None
    reminder_at: ReminderAt | None = None


class TaskEdit(BaseModel):
    """Only the fields sent are changed. null clears goal_date or reminder_at."""

    model_config = ConfigDict(extra="forbid", strict=True)

    title: Title | None = None
    category: Category | None = None
    notes: Notes | None = None
    goal_date: GoalDate | None = None
    reminder_at: ReminderAt | None = None

    @model_validator(mode="after")
    def required_fields_not_cleared(self) -> "TaskEdit":
        for name in ("title", "category", "notes"):
            if name in self.model_fields_set and getattr(self, name) is None:
                raise ValueError(f"{name} can't be cleared.")
        return self


# --- Opening the store for one request ---------------------------------------------


@contextmanager
def _store(request: Request) -> Iterator[TaskStore]:
    """Open the active database for this request and close it afterwards.

    Opened and used inside the route itself, so it stays on one thread.
    """
    state = request.app.state
    settings = load_settings()
    conn: sqlite3.Connection = open_database(db_path(state.db_kind), state.db_kind)
    try:
        yield TaskStore(conn, stale_after_days=settings.tasks.stale_after_days, clock=state.clock)
    finally:
        conn.close()


# --- Routes ------------------------------------------------------------------------


@router.get("")
def list_tasks(request: Request, status: ListFilter = "open") -> list[dict]:
    with _store(request) as store:
        return [asdict(t) for t in store.list_tasks(status)]


@router.post("", status_code=201)
def create_task(request: Request, body: TaskCreate) -> dict:
    with _store(request) as store:
        return asdict(store.create(**body.model_dump()))


@router.get("/{task_id}")
def get_task(request: Request, task_id: int) -> dict:
    with _store(request) as store:
        return asdict(store.get(task_id))


@router.patch("/{task_id}")
def edit_task(request: Request, task_id: int, body: TaskEdit) -> dict:
    with _store(request) as store:
        return asdict(store.edit(task_id, **body.model_dump(exclude_unset=True)))


@router.post("/{task_id}/complete")
def complete_task(request: Request, task_id: int) -> dict:
    with _store(request) as store:
        return asdict(store.complete(task_id))


@router.post("/{task_id}/reopen")
def reopen_task(request: Request, task_id: int) -> dict:
    with _store(request) as store:
        return asdict(store.reopen(task_id))


@router.post("/{task_id}/archive")
def archive_task(request: Request, task_id: int) -> dict:
    with _store(request) as store:
        return asdict(store.archive(task_id))


@router.get("/{task_id}/history")
def task_history(request: Request, task_id: int) -> list[dict]:
    with _store(request) as store:
        return [asdict(e) for e in store.history(task_id)]


# --- Turning errors into answers ---------------------------------------------------


def register(app: FastAPI) -> None:
    """Add the to-do routes and their error answers to the app."""
    app.include_router(router)

    @app.exception_handler(TaskNotFound)
    def _not_found(_request: Request, _exc: TaskNotFound) -> JSONResponse:
        return JSONResponse({"detail": "Task not found."}, status_code=404)

    @app.exception_handler(TaskConflict)
    def _conflict(_request: Request, exc: TaskConflict) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.exception_handler(TaskError)
    def _bad_data(_request: Request, exc: TaskError) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.exception_handler(SettingsError)
    def _settings(_request: Request, exc: SettingsError) -> JSONResponse:
        # Settings errors name the setting, never its value.
        return JSONResponse({"detail": str(exc)}, status_code=503)
