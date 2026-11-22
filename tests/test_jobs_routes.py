"""Tests for the Opportunity Office web routes (src/aicity/jobs_routes.py).

Each test gets a temporary data folder with the example settings (plus the example
[jobs] block uncommented), a fake clock and a fake Touch ID. Example platforms:
platform_a (active) and platform_b (not applied).
"""

import shutil
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from aicity import config
from aicity.db import DbKind, db_path, open_database
from aicity.main import create_app
from aicity.mode import OwnerCheck

APP_URL = "http://127.0.0.1:8765"
EXAMPLE_SETTINGS = Path(__file__).resolve().parents[1] / "settings.example.toml"
NOW = datetime(2026, 11, 29, 15, 0, tzinfo=UTC)


def example_jobs_block() -> str:
    text = EXAMPLE_SETTINGS.read_text()
    lines = []
    for line in text[text.index("# [jobs]") :].splitlines():
        if not line.startswith("#"):
            break
        lines.append(line[2:] if line.startswith("# ") else line[1:])
    return "\n".join(lines)


def _app(tmp_path, monkeypatch, kind=DbKind.PERSONAL, with_jobs=True):
    monkeypatch.setenv(config.DATA_DIR_ENV, str(tmp_path))
    (tmp_path / "settings").mkdir(exist_ok=True)
    target = tmp_path / "settings" / "settings.toml"
    shutil.copy(EXAMPLE_SETTINGS, target)
    if with_jobs:
        target.write_text(target.read_text() + "\n" + example_jobs_block() + "\n")
    app = create_app(dev=False, ask=lambda: OwnerCheck.CONFIRMED)
    app.state.clock = lambda: NOW
    app.state.db_kind = kind
    return app


def _client(app) -> TestClient:
    return TestClient(app, base_url=APP_URL, headers={"origin": APP_URL})


@pytest.fixture
def app(tmp_path, monkeypatch):
    return _app(tmp_path, monkeypatch)


@pytest.fixture
def client(app):
    """Personal mode, unlocked."""
    c = _client(app)
    key = c.post("/api/jobs/unlock").json()["key"]
    c.headers["X-Jobs-Key"] = key
    return c


def add_project(client, **overrides) -> dict:
    body = {
        "platform_id": "platform_a",
        "title": "Physics reasoning reviews",
        "pay_cents": 4500,
        "currency": "USD",
        "hours_per_week": 10,
    }
    body.update(overrides)
    response = client.post("/api/jobs/projects", json=body)
    assert response.status_code == 201, response.text
    return response.json()


LOCKED = [
    ("get", "/api/jobs/platforms", None),
    ("put", "/api/jobs/platforms/platform_a/status", {"status": "paused"}),
    ("post", "/api/jobs/platforms/platform_a/check", {"outcome": "nothing"}),
    ("put", "/api/jobs/platforms/platform_a/profile", {"resume_label": "v1"}),
    ("get", "/api/jobs/projects", None),
    ("post", "/api/jobs/projects", {"platform_id": "platform_a", "title": "X"}),
    ("put", "/api/jobs/projects/1", {"title": "Y"}),
    ("post", "/api/jobs/projects/1/status", {"status": "applied"}),
]


@pytest.mark.parametrize(("method", "url", "body"), LOCKED)
def test_every_locked_route_needs_the_key(app, method, url, body):
    c = _client(app)
    old_key = c.post("/api/jobs/unlock").json()["key"]
    c.post("/api/jobs/unlock")  # a newer key replaces the old one
    for headers in ({}, {"X-Jobs-Key": old_key}, {"X-Jobs-Key": "made-up"}):
        kwargs = {"headers": headers} | ({"json": body} if body is not None else {})
        response = getattr(c, method)(url, **kwargs)
        assert response.status_code == 403, (url, headers)
        assert response.json()["detail"] == "Opportunity Office is locked."


def test_all_locked_routes_are_listed(app):
    """A new /api/jobs route must be added to LOCKED (or be unlock/badge)."""
    listed = {
        (m, u.replace("/1", "/{project_id}").replace("platform_a", "{platform_id}"))
        for m, u, _ in LOCKED
    }
    found = {
        (method, path)
        for path, ops in app.openapi()["paths"].items()
        if path.startswith("/api/jobs")
        for method in ops
    }
    assert found - listed == {("post", "/api/jobs/unlock"), ("get", "/api/jobs/badge")}


def test_vault_key_doesnt_open_jobs(app):
    c = _client(app)
    vault_key = c.post("/api/vault/unlock").json()["key"]
    assert c.get("/api/jobs/platforms", headers={"X-Jobs-Key": vault_key}).status_code == 403


# --- Badge --------------------------------------------------------------------------


def test_badge_is_a_count_only(tmp_path, monkeypatch):
    app = _app(tmp_path, monkeypatch, with_jobs=False)
    target = tmp_path / "settings" / "settings.toml"
    target.write_text(
        target.read_text() + '\n[jobs]\n[[jobs.platforms]]\nid = "zeta"\nname = "Zeta Labs"\n'
        'url = "https://example.com/z"\nstart_status = "active"\n'
    )
    text = _client(app).get("/api/jobs/badge").json()["text"]
    assert text == "1 platform to check"
    assert "Zeta" not in text


def test_badge_plural_and_none_due(tmp_path, monkeypatch):
    app = _app(tmp_path, monkeypatch, with_jobs=False)
    target = tmp_path / "settings" / "settings.toml"
    platforms = "".join(
        f'[[jobs.platforms]]\nid = "{p}"\nname = "{p}"\n'
        f'url = "https://example.com/{p}"\nstart_status = "active"\n'
        for p in ("one", "two")
    )
    target.write_text(target.read_text() + "\n[jobs]\n" + platforms)
    c = _client(app)
    assert c.get("/api/jobs/badge").json() == {"text": "2 platforms to check"}
    c.headers["X-Jobs-Key"] = c.post("/api/jobs/unlock").json()["key"]
    for platform_id in ("one", "two"):
        c.post(f"/api/jobs/platforms/{platform_id}/check", json={"outcome": "nothing"})
    assert c.get("/api/jobs/badge").json() == {"text": None}


def test_a_status_change_starts_the_check_clock(client):
    client.put("/api/jobs/platforms/platform_b/status", json={"status": "applied"})
    assert [c["id"] for c in client.get("/api/jobs/platforms").json()["due"]] == ["platform_a"]


def test_badge_null_without_jobs(tmp_path, monkeypatch):
    app = _app(tmp_path, monkeypatch, with_jobs=False)
    assert _client(app).get("/api/jobs/badge").json() == {"text": None}


def test_badge_null_with_a_broken_settings_file(tmp_path, monkeypatch):
    app = _app(tmp_path, monkeypatch)
    (tmp_path / "settings" / "settings.toml").write_text("this is [not toml")
    response = _client(app).get("/api/jobs/badge")
    assert response.status_code == 200
    assert response.json() == {"text": None}


# --- Platforms and projects ---------------------------------------------------------


def test_sample_mode_needs_no_key(tmp_path, monkeypatch):
    app = _app(tmp_path, monkeypatch, kind=DbKind.SAMPLE)
    c = _client(app)
    assert c.post("/api/jobs/unlock").json() == {"key": None}
    assert c.get("/api/jobs/platforms").status_code == 200
    assert c.get("/api/jobs/projects").status_code == 200


def test_platforms_due_and_check(client):
    body = client.get("/api/jobs/platforms").json()
    assert [c["id"] for c in body["platforms"]] == ["platform_a", "platform_b"]
    assert [c["id"] for c in body["due"]] == ["platform_a"]
    assert [c["id"] for c in body["refresh"]] == ["platform_a"]
    after = client.post("/api/jobs/platforms/platform_a/check", json={"outcome": "nothing"})
    assert after.status_code == 200
    assert after.json()["due"] is False
    assert client.get("/api/jobs/platforms").json()["due"] == []


def test_status_and_profile(client):
    card = client.put("/api/jobs/platforms/platform_b/status", json={"status": "onboarding"})
    assert card.json()["status"] == "onboarding"
    card = client.put(
        "/api/jobs/platforms/platform_a/profile",
        json={"domains": ["python"], "assessments": ["Physics test"], "resume_label": "v1"},
    )
    assert card.json()["domains"] == ["python"]
    assert (
        client.put(
            "/api/jobs/platforms/platform_a/profile", json={"resume_label": "x" * 41}
        ).status_code
        == 422
    )
    assert (
        client.put("/api/jobs/platforms/nope/status", json={"status": "active"}).status_code == 404
    )


def test_add_and_list_projects(client):
    p = add_project(client)
    assert p["status"] == "found"
    body = client.get("/api/jobs/projects").json()
    assert [x["id"] for x in body["projects"]] == [p["id"]]
    assert body["floor_usd"] == "30" and body["preferred_usd"] == "40"
    assert body["rate"] is None


def test_project_status_and_edit(client):
    p = add_project(client)
    moved = client.post(f"/api/jobs/projects/{p['id']}/status", json={"status": "active"})
    assert moved.json()["status"] == "active"
    illegal = client.post(f"/api/jobs/projects/{p['id']}/status", json={"status": "found"})
    assert illegal.status_code == 409
    edited = client.put(f"/api/jobs/projects/{p['id']}", json={"title": "Chemistry reviews"})
    assert edited.json()["title"] == "Chemistry reviews"
    assert (
        client.post(
            "/api/jobs/projects", json={"platform_id": "platform_a", "title": ""}
        ).status_code
        == 422
    )
    assert (
        client.post("/api/jobs/projects/999/status", json={"status": "applied"}).status_code == 404
    )


def test_extra_fields_are_refused(client):
    response = client.post(
        "/api/jobs/projects",
        json={"platform_id": "platform_a", "title": "X", "description": "copied text"},
    )
    assert response.status_code == 422


def test_not_set_up_is_400(tmp_path, monkeypatch):
    app = _app(tmp_path, monkeypatch, with_jobs=False)
    c = _client(app)
    c.headers["X-Jobs-Key"] = c.post("/api/jobs/unlock").json()["key"]
    response = c.get("/api/jobs/platforms")
    assert response.status_code == 400
    assert response.json()["detail"] == "Opportunity Office isn't set up yet."


def test_rate_comes_from_the_bank_of_canada_table(client):
    conn = open_database(db_path(DbKind.PERSONAL), DbKind.PERSONAL)
    conn.execute(
        "INSERT INTO fx_rates (currency, day, rate, source, fetched_at) "
        "VALUES ('USD', '2026-11-27', '1.4000', 'boc', '2026-11-27T21:00:00Z')"
    )
    conn.commit()
    conn.close()
    p = add_project(client, pay_cents=4500, currency="CAD")
    assert p["pay_usd_cents"] == 3214
    body = client.get("/api/jobs/projects").json()
    assert body["rate"] == {"value": "1.4000", "date": "2026-11-27"}
