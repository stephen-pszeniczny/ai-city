"""Tests for GET /api/mode: tells the page which database is in use.

The to-do screen shows its "Sample mode, don't add real tasks" banner from
this answer, so it must always report the database the routes really use.
"""

from fastapi.testclient import TestClient

from aicity.db import DbKind
from aicity.main import create_app

APP_URL = "http://127.0.0.1:8765"


def test_mode_is_sample_until_the_switch_exists():
    client = TestClient(create_app(dev=False), base_url=APP_URL)
    response = client.get("/api/mode")
    assert response.status_code == 200
    assert response.json() == {"mode": "sample"}


def test_mode_follows_the_database_the_routes_use():
    app = create_app(dev=False)
    app.state.db_kind = DbKind.PERSONAL
    client = TestClient(app, base_url=APP_URL)
    assert client.get("/api/mode").json() == {"mode": "personal"}


def test_mode_cannot_be_changed_through_this_address():
    client = TestClient(create_app(dev=False), base_url=APP_URL, headers={"origin": APP_URL})
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        assert client.request(method, "/api/mode").status_code == 405, method
    assert client.get("/api/mode").json() == {"mode": "sample"}
