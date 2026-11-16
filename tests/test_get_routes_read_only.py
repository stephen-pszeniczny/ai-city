"""Every GET route must only read: calling it may never change any data.

The test finds GET routes by itself (from FastAPI's public route listing,
app.openapi(), which works even though the docs pages are switched off), so
a route added later is checked without editing this file. It fills in path parameters from PARAM_VALUES;
a route with a parameter not listed there fails loudly, so it can't be
skipped by accident.

"Unchanged" is checked byte for byte across every file in the data folder.
"""

import hashlib
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from aicity import config
from aicity.main import create_app

APP_URL = "http://127.0.0.1:8765"
EXAMPLE_SETTINGS = Path(__file__).resolve().parents[1] / "settings.example.toml"
EXPECTED_AT_LEAST = {
    "/api/health",
    "/api/mode",
    "/api/buildings",
    "/api/tasks",
    "/api/tasks/{task_id}",
    "/api/tasks/{task_id}/history",
}
# Extra query strings worth trying on particular routes.
QUERY_VARIANTS = {
    "/api/tasks": ["", "?status=open", "?status=done", "?status=archived", "?status=all"]
}


def snapshot(folder: Path) -> dict[str, str]:
    """Name -> SHA-256 of every file under folder."""
    return {
        str(p.relative_to(folder)): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(folder.rglob("*"))
        if p.is_file()
    }


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setenv(config.DATA_DIR_ENV, str(tmp_path))
    (tmp_path / "settings").mkdir()
    shutil.copy(EXAMPLE_SETTINGS, tmp_path / "settings" / "settings.toml")
    app = create_app(dev=False)
    client = TestClient(app, base_url=APP_URL, headers={"origin": APP_URL})

    # Some data in every state, so each route has something to read.
    ids = []
    for title in ("Open", "Done", "Archived"):
        r = client.post("/api/tasks", json={"title": title, "category": "work"})
        ids.append(r.json()["id"])
    client.patch(f"/api/tasks/{ids[0]}", json={"notes": "edited"})
    client.post(f"/api/tasks/{ids[1]}/complete")
    client.post(f"/api/tasks/{ids[2]}/archive")
    return app, client, tmp_path, ids


def get_routes(app) -> dict[str, set[str]]:
    """GET path -> names of its path parameters."""
    routes = {}
    for path, operations in app.openapi()["paths"].items():
        if "get" in operations:
            params = operations["get"].get("parameters", [])
            routes[path] = {p["name"] for p in params if p["in"] == "path"}
    return routes


def test_all_known_get_routes_are_found(setup):
    app, *_ = setup
    assert EXPECTED_AT_LEAST <= set(get_routes(app))


def test_no_get_route_changes_any_data(setup):
    app, client, data_dir, ids = setup
    before = snapshot(data_dir)
    assert any(name.endswith("sample.db") for name in before)

    calls = 0
    for path, params in sorted(get_routes(app).items()):
        for task_id in ids if "task_id" in params else [None]:
            unknown = set(params) - {"task_id"}
            assert not unknown, f"Add a value for {unknown} to this test (route {path})."
            url = path.replace("{task_id}", str(task_id))
            for query in QUERY_VARIANTS.get(path, [""]):
                response = client.get(url + query)
                assert response.status_code == 200, f"GET {url + query}: {response.status_code}"
                calls += 1

    assert calls >= 12
    assert snapshot(data_dir) == before, "A GET route changed data."
