"""Opportunity Office web routes: the platform tracker.

    POST /api/jobs/unlock                         Touch ID -> {"key"} (null in Sample mode)
    GET  /api/jobs/badge                          {"text"}: "2 platforms to check" or null
    GET  /api/jobs/platforms                      {"platforms", "due", "refresh", "current_resume_label"}
    PUT  /api/jobs/platforms/{platform_id}/status   {status} -> the card
    POST /api/jobs/platforms/{platform_id}/check    {outcome: nothing | found} -> the card
    PUT  /api/jobs/platforms/{platform_id}/profile  {any profile field} -> the card
    GET  /api/jobs/projects                       {"projects", "rate", "floor_usd", "preferred_usd"}
    POST /api/jobs/projects                       log a project -> 201 the project
    PUT  /api/jobs/projects/{project_id}          {title?, pay_cents?, currency?, hours_per_week?}
    POST /api/jobs/projects/{project_id}/status   {status} -> the project

Career data is sensitive (spec section 4): in Personal mode every route but unlock and
badge needs the X-Jobs-Key header from unlock (403 without it). The badge is a count
only and never fails: no [jobs] section, or any settings problem, gives null. Sample
mode needs no key and uses its own made-up settings. Nothing here fetches anything.

Answers: 400 no [jobs] section in settings, 403 locked, 404 no such platform or project,
409 a status move the project doesn't allow, 422 bad input.
"""

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import asdict

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from aicity import sample_data
from aicity.db import DbKind, db_path, open_database
from aicity.fx import latest_rate
from aicity.jobs_settings import JobsSettings
from aicity.jobs_store import JobsConflict, JobsError, JobsNotFound, JobsStore
from aicity.settings import SettingsError, load_settings

KEY_HEADER = "X-Jobs-Key"


def _require_key(request: Request) -> None:
    state = request.app.state
    # Read the mode once: the handler opens this same mode's database (_kind), so a
    # mode switch landing between the key check and the open can't skip the key.
    kind = request.state.db_kind = DbKind(state.db_kind)
    if kind == DbKind.PERSONAL and not state.jobs_lock.allows(request.headers.get(KEY_HEADER)):
        raise HTTPException(status_code=403, detail="Opportunity Office is locked.")


router = APIRouter(prefix="/api/jobs", dependencies=[Depends(_require_key)])
open_router = APIRouter(prefix="/api/jobs")


class NotSetUp(Exception):
    """Settings have no [jobs] section."""


# --- What the page may send -------------------------------------------------------------


class _Body(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class StatusIn(_Body):
    status: str


class CheckIn(_Body):
    outcome: str


class ProfileIn(_Body):
    pay_low_cents: int | None = None
    pay_high_cents: int | None = None
    pay_currency: str | None = None
    resume_label: str | None = None
    domains: list[str] | None = None
    assessments: list[str] | None = None
    profile_updated_on: str | None = None


class ProjectIn(_Body):
    platform_id: str
    title: str
    pay_cents: int | None = None
    currency: str | None = None
    hours_per_week: int | None = None


class ProjectEditIn(_Body):
    title: str | None = None
    pay_cents: int | None = None
    currency: str | None = None
    hours_per_week: int | None = None


# --- Opening the store for one request ---------------------------------------------------


def _kind(request: Request) -> DbKind:
    """The mode this request was checked under (falls back to the current mode)."""
    return getattr(request.state, "db_kind", None) or DbKind(request.app.state.db_kind)


def _sample(request: Request) -> bool:
    return _kind(request) == DbKind.SAMPLE


def _settings(request: Request) -> JobsSettings:
    if _sample(request):
        return sample_data.SAMPLE_JOBS
    jobs = load_settings().jobs
    if jobs is None:
        raise NotSetUp
    return jobs


def _rate(request: Request, conn: sqlite3.Connection):
    found = latest_rate(conn)
    if found is None and _sample(request):
        today = request.app.state.clock().astimezone().date()
        return sample_data.sample_rate(today), today
    return found


@contextmanager
def _open(request: Request) -> Iterator[tuple[JobsStore, JobsSettings, object]]:
    state = request.app.state
    settings = _settings(request)
    kind = _kind(request)
    conn = open_database(db_path(kind), kind)
    try:
        rate = _rate(request, conn)
        store = JobsStore(conn, settings, clock=state.clock, usd_rate=rate[0] if rate else None)
        yield store, settings, rate
    finally:
        conn.close()


def _given(body: BaseModel) -> dict:
    """Only the fields the page actually sent (a missing field stays as it was)."""
    return body.model_dump(exclude_unset=True)


# --- Routes ------------------------------------------------------------------------------


@open_router.post("/unlock")
def unlock(request: Request) -> dict[str, str | None]:
    """Touch ID once per app session. Sample mode has nothing to lock."""
    if _sample(request):
        return {"key": None}
    return {"key": request.app.state.jobs_lock.unlock()}


@open_router.get("/badge")
def badge(request: Request) -> dict[str, str | None]:
    """The belt badge. No Touch ID needed: a count only, never a platform name."""
    try:
        with _open(request) as (store, _settings_found, _rate_found):
            due = store.due_count()
    except (NotSetUp, SettingsError, OSError):
        return {"text": None}
    if not due:
        return {"text": None}
    return {"text": f"{due} platform{'' if due == 1 else 's'} to check"}


@router.get("/platforms")
def get_platforms(request: Request) -> dict:
    with _open(request) as (store, _settings_found, _rate_found):
        cards = store.platforms()
        resume = store.current_resume_label()
    return {
        "current_resume_label": resume,
        "platforms": [asdict(c) for c in cards],
        "due": [asdict(c) for c in cards if c.due],
        "refresh": [asdict(c) for c in cards if c.refresh_due],
    }


@router.put("/platforms/{platform_id}/status")
def put_status(request: Request, platform_id: str, body: StatusIn) -> dict:
    with _open(request) as (store, _settings_found, _rate_found):
        return asdict(store.set_status(platform_id, body.status))


@router.post("/platforms/{platform_id}/check")
def post_check(request: Request, platform_id: str, body: CheckIn) -> dict:
    with _open(request) as (store, _settings_found, _rate_found):
        return asdict(store.record_check(platform_id, body.outcome))


@router.put("/platforms/{platform_id}/profile")
def put_profile(request: Request, platform_id: str, body: ProfileIn) -> dict:
    with _open(request) as (store, _settings_found, _rate_found):
        return asdict(store.set_profile(platform_id, **_given(body)))


@router.get("/projects")
def get_projects(request: Request) -> dict:
    with _open(request) as (store, settings, rate):
        projects = store.projects()
    return {
        "projects": [asdict(p) for p in projects],
        "rate": None if rate is None else {"value": str(rate[0]), "date": rate[1].isoformat()},
        "floor_usd": str(settings.pay_floor_usd),
        "preferred_usd": str(settings.pay_preferred_usd),
    }


@router.post("/projects", status_code=201)
def post_project(request: Request, body: ProjectIn) -> dict:
    with _open(request) as (store, _settings_found, _rate_found):
        return asdict(
            store.add_project(
                platform_id=body.platform_id,
                title=body.title,
                pay_cents=body.pay_cents,
                currency=body.currency,
                hours_per_week=body.hours_per_week,
            )
        )


@router.put("/projects/{project_id}")
def put_project(request: Request, project_id: int, body: ProjectEditIn) -> dict:
    with _open(request) as (store, _settings_found, _rate_found):
        return asdict(store.edit_project(project_id, **_given(body)))


@router.post("/projects/{project_id}/status")
def post_project_status(request: Request, project_id: int, body: StatusIn) -> dict:
    with _open(request) as (store, _settings_found, _rate_found):
        return asdict(store.set_project_status(project_id, body.status))


def register(app: FastAPI) -> None:
    app.include_router(open_router)
    app.include_router(router)

    @app.exception_handler(NotSetUp)
    def _not_set_up(_request: Request, _exc: NotSetUp) -> JSONResponse:
        return JSONResponse({"detail": "Opportunity Office isn't set up yet."}, status_code=400)

    @app.exception_handler(JobsError)
    def _bad(_request: Request, exc: JobsError) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.exception_handler(JobsNotFound)
    def _missing(_request: Request, exc: JobsNotFound) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=404)

    @app.exception_handler(JobsConflict)
    def _conflict(_request: Request, exc: JobsConflict) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=409)
