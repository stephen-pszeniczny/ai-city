"""The FastAPI app: the backend 'engine' the browser page talks to.

Start it with the launcher, which takes the address from config.py and
refuses anything but this Mac:
    .venv/bin/python scripts/run_app.py
"""

from fastapi import FastAPI

from aicity import config, task_routes
from aicity.db import DbKind
from aicity.security import FrontDoorMiddleware
from aicity.tasks import utc_now


def create_app(*, dev: bool | None = None) -> FastAPI:
    """Build the app. dev=None means: read AICITY_DEV from the environment."""
    if dev is None:
        dev = config.dev_mode()

    app = FastAPI(
        title="AI City",
        # The auto-generated API docs pages aren't needed and would be one more
        # thing exposed; turn them off.
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )
    # The front door lock runs before anything else sees the request.
    app.add_middleware(FrontDoorMiddleware, dev=dev)

    # Which database the routes use. Always Sample until the Personal / Sample
    # switch (with Touch ID) is built, so unfinished features never touch real data.
    app.state.db_kind = DbKind.SAMPLE
    # The clock the routes use; tests replace it with a fake one.
    app.state.clock = utc_now

    task_routes.register(app)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        """Answers 'I'm alive'. Used by the page and by checks to confirm the app runs."""
        return {"status": "ok"}

    return app


app = create_app()
