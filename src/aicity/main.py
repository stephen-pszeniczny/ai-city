"""The FastAPI app: the backend 'engine' the browser page talks to.

Start it during development with:
    .venv/bin/uvicorn aicity.main:app --app-dir src --host 127.0.0.1 --port 8765
"""

from fastapi import FastAPI

app = FastAPI(
    title="AI City",
    # The auto-generated API docs pages aren't needed and would be one more
    # thing exposed; turn them off.
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@app.get("/api/health")
def health() -> dict[str, str]:
    """Answers 'I'm alive'. Used by the page and by checks to confirm the app runs."""
    return {"status": "ok"}
