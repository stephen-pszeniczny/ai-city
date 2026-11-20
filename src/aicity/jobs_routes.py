"""Opportunity Office web routes.

    POST /api/jobs/unlock                    Touch ID -> {"key"} (null in Sample mode)
    GET  /api/jobs/badge                     {"text"}: "4 new leads" or null. Counts only.
    GET  /api/jobs/leads                     the inbox, the profile and the exchange rate
    POST /api/jobs/leads                     paste a role -> 201 the lead
    POST /api/jobs/leads/{lead_id}/status    {status, resume_label?} -> the lead
    POST /api/jobs/leads/skip-rest           skip the New list -> {"skipped"}
    GET  /api/jobs/platforms                 {"platforms", "nudges"}
    PUT  /api/jobs/platforms/{platform_id}   {stage?, next_step?, snooze?} -> the platform

Job applications are sensitive (spec section 4): in Personal mode every route but
unlock and badge needs the X-Jobs-Key header from unlock (403 without it). Sample
mode needs no key and uses its own made-up settings. A profile is chosen with
?profile=, else the first active one.

Answers: 400 no [jobs] section in settings, 403 locked, 404 no such lead, profile or
platform, 409 a status change the lead doesn't allow, 422 bad input.
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
from aicity.settings import load_settings

KEY_HEADER = "X-Jobs-Key"


def _require_key(request: Request) -> None:
    state = request.app.state
    if state.db_kind == DbKind.PERSONAL and not state.jobs_lock.allows(
        request.headers.get(KEY_HEADER)
    ):
        raise HTTPException(status_code=403, detail="Opportunity Office is locked.")


router = APIRouter(prefix="/api/jobs", dependencies=[Depends(_require_key)])
open_router = APIRouter(prefix="/api/jobs")


class NotSetUp(Exception):
    """Settings have no [jobs] section."""


# --- What the page may send -------------------------------------------------------------


class _Body(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


class PasteIn(_Body):
    url: str | None = None
    title: str
    company: str
    location: str = ""
    text: str = ""


class StatusIn(_Body):
    status: str
    resume_label: str | None = None


class PlatformIn(_Body):
    stage: str | None = None
    next_step: str | None = None
    snooze: bool = False


# --- Opening the store for one request ---------------------------------------------------


def _sample(request: Request) -> bool:
    return request.app.state.db_kind == DbKind.SAMPLE


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
    conn = open_database(db_path(state.db_kind), state.db_kind)
    try:
        rate = _rate(request, conn)
        store = JobsStore(conn, settings, clock=state.clock, usd_rate=rate[0] if rate else None)
        yield store, settings, rate
    finally:
        conn.close()


def _profile_id(settings: JobsSettings, requested: str | None) -> str:
    if requested:
        return requested
    active = [p for p in settings.profiles if p.active]
    return (active or list(settings.profiles))[0].id


# --- Routes ------------------------------------------------------------------------------


@open_router.post("/unlock")
def unlock(request: Request) -> dict[str, str | None]:
    """Touch ID once per app session. Sample mode has nothing to lock."""
    if _sample(request):
        return {"key": None}
    return {"key": request.app.state.jobs_lock.unlock()}


@open_router.get("/badge")
def badge(request: Request) -> dict[str, str | None]:
    """The belt badge. No Touch ID needed: counts only, never names or titles."""
    try:
        with _open(request) as (store, settings, _rate_found):
            new = store.badge_counts(_profile_id(settings, None))["new"]
    except NotSetUp:
        return {"text": None}
    if not new:
        return {"text": None}
    return {"text": f"{new} new lead" + ("" if new == 1 else "s")}


@router.get("/leads")
def get_leads(request: Request, profile: str | None = None) -> dict:
    with _open(request) as (store, settings, rate):
        profile_id = _profile_id(settings, profile)
        inbox = store.list_leads(profile_id)
        chosen = next(p for p in settings.profiles if p.id == profile_id)
        return asdict(inbox) | {
            "profile": {"id": chosen.id, "name": chosen.name},
            "rate": None if rate is None else {"value": str(rate[0]), "date": rate[1].isoformat()},
        }


@router.post("/leads", status_code=201)
def paste_lead(request: Request, body: PasteIn, profile: str | None = None) -> dict:
    with _open(request) as (store, settings, _rate_found):
        lead = store.paste(
            url=body.url,
            title=body.title,
            company=body.company,
            location=body.location,
            text=body.text,
            profile_id=_profile_id(settings, profile),
        )
        return asdict(lead)


@router.post("/leads/skip-rest")
def skip_rest(request: Request, profile: str | None = None) -> dict[str, int]:
    with _open(request) as (store, settings, _rate_found):
        return {"skipped": store.skip_rest(_profile_id(settings, profile))}


@router.post("/leads/{lead_id}/status")
def set_status(request: Request, lead_id: int, body: StatusIn) -> dict:
    with _open(request) as (store, _settings_found, _rate_found):
        return asdict(store.set_status(lead_id, body.status, body.resume_label))


@router.get("/platforms")
def get_platforms(request: Request) -> dict:
    with _open(request) as (store, _settings_found, _rate_found):
        return {
            "platforms": [asdict(p) for p in store.platforms()],
            "nudges": [asdict(p) for p in store.nudges()],
        }


@router.put("/platforms/{platform_id}")
def put_platform(request: Request, platform_id: str, body: PlatformIn) -> dict:
    with _open(request) as (store, _settings_found, _rate_found):
        view = store.set_platform(
            platform_id, stage=body.stage, next_step=body.next_step, snooze=body.snooze
        )
        return asdict(view)


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
