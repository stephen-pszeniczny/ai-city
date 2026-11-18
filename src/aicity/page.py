"""Serving the built page, so the app runs without a dev server.

In normal mode (not AICITY_DEV) the backend hands out frontend/dist itself:
  /assets/<file>   files from dist/assets, and only from there
  anything else    dist/index.html; the page's own router handles /b/<id> etc.
/api/... is never answered here: an unknown API address stays a JSON 404.

If the page hasn't been built, the page addresses answer 503 with the command to
build it. Build it with:  cd frontend && npm run build
"""

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

REPO_ROOT = Path(__file__).resolve().parents[2]
DIST = REPO_ROOT / "frontend" / "dist"

NOT_BUILT = "The page isn't built yet. Run: cd frontend && npm run build\n"


def register(app: FastAPI, dist: Path = DIST) -> None:
    """Serve the page: /assets files, and the page for any other unknown address."""
    assets = (dist / "assets").resolve()
    index = dist / "index.html"

    # Kept out of the API listing: they only read files, and the read-only check
    # (tests/test_get_routes_read_only.py) is about the API's data.
    @app.get("/assets/{path:path}", include_in_schema=False)
    def asset(path: str) -> Response:
        file = (assets / path).resolve()
        if not file.is_relative_to(assets) or not file.is_file():
            return JSONResponse({"detail": "Not Found"}, status_code=404)
        return FileResponse(file)

    # Every other address the app has no route for gets the page (only for reading,
    # never under /api). Done as the "not found" answer rather than a catch-all
    # route, so it can never shadow a real route, whenever that route was added.
    @app.exception_handler(StarletteHTTPException)
    async def page_or_not_found(request: Request, exc: StarletteHTTPException) -> Response:
        path = request.url.path
        wants_page = (
            exc.status_code == 404
            and request.method in ("GET", "HEAD")
            and path != "/api"
            and not path.startswith("/api/")
        )
        if not wants_page:
            return await http_exception_handler(request, exc)
        if not index.is_file():
            return PlainTextResponse(NOT_BUILT, status_code=503)
        # Always re-check the page: after an update the old one would point at deleted files.
        return FileResponse(index, media_type="text/html", headers={"Cache-Control": "no-cache"})
