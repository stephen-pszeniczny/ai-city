"""Tests for the grocery list web routes (src/aicity/grocery_routes.py).

Each test gets a temporary data folder with the example settings and a fake clock.
"""

import shutil
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from aicity import config
from aicity.db import DbKind, db_path
from aicity.main import create_app

APP_URL = "http://127.0.0.1:8765"
EXAMPLE_SETTINGS = Path(__file__).resolve().parents[1] / "settings.example.toml"


def _client(tmp_path, monkeypatch, kind=DbKind.PERSONAL) -> TestClient:
    monkeypatch.setenv(config.DATA_DIR_ENV, str(tmp_path))
    (tmp_path / "settings").mkdir(exist_ok=True)
    shutil.copy(EXAMPLE_SETTINGS, tmp_path / "settings" / "settings.toml")
    app = create_app(dev=False)
    app.state.clock = lambda: datetime(2026, 11, 29, 15, 0, tzinfo=UTC)
    app.state.db_kind = kind
    return TestClient(app, base_url=APP_URL, headers={"origin": APP_URL})


@pytest.fixture
def client(tmp_path, monkeypatch):
    return _client(tmp_path, monkeypatch)


def add(client, name: str) -> dict:
    response = client.post("/api/grocery", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()


def test_get_reads_the_list(client):
    assert client.get("/api/grocery").json() == {"items": [], "open": 0}
    eggs = add(client, "Eggs")
    assert client.get("/api/grocery").json() == {
        "items": [{"id": eggs["id"], "name": "Eggs", "ticked": False}],
        "open": 1,
    }


def test_a_duplicate_returns_the_same_item(client):
    eggs = add(client, "Eggs")
    assert add(client, " eggs ")["id"] == eggs["id"]
    assert client.get("/api/grocery").json()["open"] == 1


def test_tick_untick_remove_and_clear(client):
    eggs, rice = add(client, "Eggs"), add(client, "Rice")
    assert client.post(f"/api/grocery/{eggs['id']}/tick", json={"ticked": True}).json()["ticked"]
    assert client.post(f"/api/grocery/{eggs['id']}/tick", json={"ticked": False}).json() == {
        "id": eggs["id"],
        "name": "Eggs",
        "ticked": False,
    }
    assert client.post(f"/api/grocery/{rice['id']}/remove").json() == {"removed": True}
    client.post(f"/api/grocery/{eggs['id']}/tick", json={"ticked": True})
    assert client.post("/api/grocery/clear-ticked").json() == {"cleared": 1}
    assert client.get("/api/grocery").json() == {"items": [], "open": 0}


def test_unknown_item_is_404(client):
    client.get("/api/grocery")
    # The message proves it's the item that's missing, not the route.
    for response in (
        client.post("/api/grocery/999/tick", json={"ticked": True}),
        client.post("/api/grocery/999/remove"),
    ):
        assert (response.status_code, response.json()) == (404, {"detail": "Item not found."})


def test_a_cleared_item_is_409(client):
    eggs = add(client, "Eggs")
    client.post(f"/api/grocery/{eggs['id']}/remove")
    response = client.post(f"/api/grocery/{eggs['id']}/tick", json={"ticked": True})
    assert response.status_code == 409
    assert response.json() == {"detail": "That item was taken off the list."}


@pytest.mark.parametrize(
    "body", [{"name": ""}, {"name": "   "}, {"name": "x" * 101}, {"name": "Eggs", "qty": 2}, {}]
)
def test_bad_add_is_422(client, body):
    assert client.post("/api/grocery", json=body).status_code == 422


def test_sample_mode_uses_the_sample_database(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch, kind=DbKind.SAMPLE)
    add(client, "Lemons")
    assert db_path(DbKind.SAMPLE).exists()
    assert not db_path(DbKind.PERSONAL).exists()
