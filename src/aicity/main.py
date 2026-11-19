"""The FastAPI app: the backend 'engine' the browser page talks to.

Start it with the launcher, which takes the address from config.py and
refuses anything but this Mac:
    .venv/bin/python scripts/run_app.py
"""

from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from aicity import config, mac_notify, notification_routes, page, task_routes, vault_routes
from aicity.db import DbKind
from aicity.mac_messages import MacMessage, plan_mac_messages
from aicity.mode import (
    ModeSwitcher,
    OwnerCheck,
    SwitchBusy,
    SwitchRefused,
    SwitchUnavailable,
    ask_owner,
    load_saved_mode,
)
from aicity.notifications import Notification
from aicity.presence import Presence
from aicity.reminder_loop import ReminderLoop, check_all_databases
from aicity.security import FrontDoorMiddleware
from aicity.settings import BUILDING_IDS, load_settings
from aicity.sky import daylight_at
from aicity.tasks import utc_now
from aicity.vault_lock import VaultLock


class ModeChange(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    mode: Literal["sample", "personal"]


def _mac_notify(app: FastAPI, new: list[Notification]) -> None:
    """New Personal reminders: post a Mac notification unless the owner is looking (see mac_messages)."""
    sample_mode = DbKind(app.state.db_kind) is DbKind.SAMPLE
    for message in plan_mac_messages(
        [n.title for n in new], sample_mode=sample_mode, looking=app.state.presence.looking()
    ):
        # The owner may have switched to Sample since planning: never post a title then.
        if not sample_mode and DbKind(app.state.db_kind) is DbKind.SAMPLE and len(new) == 1:
            message = MacMessage("Reminder", "You have a reminder")
        mac_notify.post(message)


def create_app(
    *,
    dev: bool | None = None,
    ask: Callable[[], OwnerCheck] = ask_owner,
    background: bool = False,
    dist: Path | None = None,
) -> FastAPI:
    """Build the app.

    dev=None means: read AICITY_DEV from the environment.
    ask is the Touch ID check; tests pass a fake one.
    background=True runs the reminder check every 30 seconds while the app is
    up (scripts/run_app.py turns it on; tests leave it off).
    dist is the built page to serve in normal mode (default frontend/dist);
    in dev mode the Vite dev server serves the page instead.
    """
    if dev is None:
        dev = config.dev_mode()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if background:
            app.state.reminder_loop = ReminderLoop(
                lambda: app.state.clock(),
                check=lambda clock: check_all_databases(
                    clock, notify=lambda new: _mac_notify(app, new)
                ),
            )
            app.state.reminder_loop.start()
        try:
            yield
        finally:
            if app.state.reminder_loop is not None:
                app.state.reminder_loop.stop()

    app = FastAPI(
        lifespan=lifespan,
        title="Asteroid Belt",
        # The auto-generated API docs pages aren't needed and would be one more
        # thing exposed; turn them off.
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    # The front door lock runs before anything else sees the request.
    app.add_middleware(FrontDoorMiddleware, dev=dev)

    # Which database the routes use: the mode saved last time (Sample if none).
    app.state.db_kind = load_saved_mode()
    app.state.mode_switcher = ModeSwitcher(app.state, ask)
    # The Vault's Touch ID lock (memory only, so a restart locks it again).
    app.state.vault_lock = VaultLock(ask)
    # The clock the routes use; tests replace it with a fake one.
    app.state.clock = utc_now
    app.state.reminder_loop = None
    # Whether the owner is looking at the app (the page reports it; memory only).
    app.state.presence = Presence(lambda: app.state.clock())

    task_routes.register(app)
    notification_routes.register(app)
    vault_routes.register(app)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        """Answers 'I'm alive'. Used by the page and by checks to confirm the app runs."""
        return {"status": "ok"}

    @app.get("/api/mode")
    def mode(request: Request) -> dict[str, str]:
        """Which database the routes use ('sample' or 'personal').

        The page shows its "Sample mode, don't add real tasks" banner from this.
        """
        return {"mode": DbKind(request.app.state.db_kind).value}

    @app.put("/api/mode")
    def change_mode(request: Request, body: ModeChange) -> dict[str, str]:
        """Switch modes. Going to Personal waits for Touch ID (or the Mac password).

        Answers: 200 the mode now in use, 403 Touch ID didn't confirm,
        409 a switch is already waiting, 503 Touch ID can't run.
        """
        switched = request.app.state.mode_switcher.switch(DbKind(body.mode))
        # Any switch locks the Vault again, so Touch ID is asked afresh.
        request.app.state.vault_lock.forget()
        if switched is DbKind.SAMPLE:
            # Take any real reminder titles off the screen before a demo.
            mac_notify.clear()
        return {"mode": switched.value}

    @app.exception_handler(SwitchRefused)
    def _refused(_request: Request, exc: SwitchRefused) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=403)

    @app.exception_handler(SwitchBusy)
    def _busy(_request: Request, exc: SwitchBusy) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=409)

    @app.exception_handler(SwitchUnavailable)
    def _unavailable(_request: Request, exc: SwitchUnavailable) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=503)

    @app.get("/api/buildings")
    def buildings() -> list[dict[str, str]]:
        """The nine buildings, in fixed ID order, with display names from the settings file.

        The 3D belt labels each building from this. A missing or invalid
        settings file answers 503 (see task_routes.register), never made-up names.
        """
        names = load_settings().buildings
        return [{"id": bid, "name": names[bid]} for bid in BUILDING_IDS]

    @app.get("/api/daylight")
    def daylight(request: Request) -> dict[str, object]:
        """Day or night at the settings' location, for the belt's day and night mode.

        Worked out on this Mac (no feed). The page asks again at next_change.
        The location itself is never sent back, only the answer. A missing or
        invalid settings file answers 503.
        """
        d = daylight_at(request.app.state.clock(), load_settings().location)
        return {
            "is_night": d.is_night,
            "sunrise": d.sunrise.isoformat() if d.sunrise else None,
            "sunset": d.sunset.isoformat() if d.sunset else None,
            "next_change": d.next_change.isoformat(),
            "moon_phase": round(d.moon_phase, 4),
        }

    # The page for addresses no route answers (never /api); see page.py.
    if not dev:
        page.register(app, dist if dist is not None else page.DIST)

    return app


app = create_app()
