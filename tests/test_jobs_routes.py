"""Tests for the Opportunity Office web routes (src/aicity/jobs_routes.py).

Each test gets a temporary data folder with the example settings (plus the example
[jobs] block uncommented), a fake clock and a fake Touch ID.
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


def paste(client, **overrides) -> dict:
    body = {
        "url": "https://example.com/job/1",
        "title": "AI Trainer",
        "company": "Zeta Labs",
        "location": "Remote - Canada",
        "text": "Contract. $45/hr. Python and technical writing.",
    }
    body.update(overrides)
    response = client.post("/api/jobs/leads", json=body)
    assert response.status_code == 201, response.text
    return response.json()


LOCKED = [
    ("get", "/api/jobs/leads", None),
    ("post", "/api/jobs/leads", {"title": "A", "company": "B", "text": ""}),
    ("post", "/api/jobs/leads/1/status", {"status": "saved"}),
    ("post", "/api/jobs/leads/skip-rest", None),
    ("get", "/api/jobs/platforms", None),
    ("put", "/api/jobs/platforms/platform_a", {"stage": "active"}),
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
        (m, u.replace("/1/", "/{lead_id}/").replace("platform_a", "{platform_id}"))
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
    assert c.get("/api/jobs/leads", headers={"X-Jobs-Key": vault_key}).status_code == 403


def test_badge_names_nothing(client):
    paste(client)
    text = client.get("/api/jobs/badge", headers={"X-Jobs-Key": ""}).json()["text"]
    assert text == "1 new lead"
    assert "Zeta" not in text and "Trainer" not in text


def test_badge_plural_and_empty(client):
    assert client.get("/api/jobs/badge").json() == {"text": None}
    paste(client)
    paste(client, url="https://example.com/job/2", title="Evaluator")
    assert client.get("/api/jobs/badge").json() == {"text": "2 new leads"}


def test_sample_mode_needs_no_key(tmp_path, monkeypatch):
    c = _client(_app(tmp_path, monkeypatch, kind=DbKind.SAMPLE))
    assert c.post("/api/jobs/unlock").json() == {"key": None}
    assert c.get("/api/jobs/leads").status_code == 200
    assert c.get("/api/jobs/platforms").status_code == 200


def test_paste_shows_in_new(client):
    lead = paste(client)
    body = client.get("/api/jobs/leads").json()
    assert [x["id"] for x in body["new"]] == [lead["id"]]
    assert body["profile"] == {"id": "ai_training", "name": "AI training"}
    assert lead["pay_low_usd"] == 4500


def test_paste_bad_input_is_422(client):
    response = client.post(
        "/api/jobs/leads", json={"title": " ", "company": "B", "text": "x", "url": None}
    )
    assert response.status_code == 422


def test_status_changes(client):
    lead = paste(client)
    url = f"/api/jobs/leads/{lead['id']}/status"
    r = client.post(url, json={"status": "applied", "resume_label": "v3 Nov 2026"})
    assert r.status_code == 200 and r.json()["status"] == "applied"
    assert client.post(url, json={"status": "new"}).status_code == 409
    assert client.post("/api/jobs/leads/999/status", json={"status": "saved"}).status_code == 404
    assert client.post(url, json={"status": "hired"}).status_code == 422


def test_skip_rest(client):
    paste(client)
    paste(client, url="https://example.com/job/2", title="Evaluator")
    assert client.post("/api/jobs/leads/skip-rest").json() == {"skipped": 2}
    assert client.get("/api/jobs/leads").json()["new"] == []


def test_platforms(client):
    body = client.get("/api/jobs/platforms").json()
    assert [p["id"] for p in body["platforms"]] == ["platform_a", "platform_b"]
    assert body["nudges"] == []
    r = client.put(
        "/api/jobs/platforms/platform_b", json={"stage": "applied", "next_step": "Do the test"}
    )
    assert r.status_code == 200 and r.json()["stage"] == "applied"
    assert [p["id"] for p in client.get("/api/jobs/platforms").json()["nudges"]] == ["platform_b"]
    assert client.put("/api/jobs/platforms/nope", json={"stage": "active"}).status_code == 404
    assert client.put("/api/jobs/platforms/platform_a", json={"stage": "hired"}).status_code == 422


def test_not_set_up_is_400(tmp_path, monkeypatch):
    app = _app(tmp_path, monkeypatch, with_jobs=False)
    c = _client(app)
    c.headers["X-Jobs-Key"] = c.post("/api/jobs/unlock").json()["key"]
    response = c.get("/api/jobs/leads")
    assert response.status_code == 400
    assert response.json()["detail"] == "Opportunity Office isn't set up yet."
    assert c.get("/api/jobs/badge").json() == {"text": None}


def test_rate_comes_from_the_bank_of_canada_table(client, app):
    conn = open_database(db_path(DbKind.PERSONAL), DbKind.PERSONAL)
    try:
        conn.execute(
            "INSERT INTO fx_rates (currency, day, rate, source, fetched_at) "
            "VALUES ('USD', '2026-11-27', '1.4000', 'boc', '2026-11-28T00:00:00Z')"
        )
        conn.commit()
    finally:
        conn.close()
    lead = paste(client, text="Contract. $56 CAD per hour.")
    body = client.get("/api/jobs/leads").json()
    assert body["rate"] == {"value": "1.4000", "date": "2026-11-27"}
    assert lead["pay_low_usd"] == 4000
