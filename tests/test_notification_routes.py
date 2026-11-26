"""Tests for the notification web routes (src/aicity/notification_routes.py).

Same set-up as the task route tests: a temporary data folder with the example
settings, a fake clock, the app's own Origin header. The app starts in Sample
mode. Notifications are made by running the reminder check on the Sample file
directly, because the GET route itself must only read.
"""

import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient

from aicity import config
from aicity.db import DbKind, db_path, open_database
from aicity.main import create_app
from aicity.notifications import NotificationStore

APP_URL = "http://127.0.0.1:8765"
EXAMPLE_SETTINGS = Path(__file__).resolve().parents[1] / "settings.example.toml"
START = datetime(2026, 11, 15, 21, 0, 0, tzinfo=UTC)
LOCAL = ZoneInfo("Europe/London")


class FakeClock:
    def __init__(self) -> None:
        self.now = START

    def __call__(self) -> datetime:
        return self.now


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv(config.DATA_DIR_ENV, str(tmp_path))
    (tmp_path / "settings").mkdir()
    shutil.copy(EXAMPLE_SETTINGS, tmp_path / "settings" / "settings.toml")
    return tmp_path


@pytest.fixture
def clock():
    return FakeClock()


@pytest.fixture
def client(data_dir, clock):
    app = create_app(dev=False)
    app.state.clock = clock
    return TestClient(app, base_url=APP_URL, headers={"origin": APP_URL})


def run_check(clock) -> None:
    conn = open_database(db_path(DbKind.SAMPLE), DbKind.SAMPLE)
    try:
        NotificationStore(conn, clock, LOCAL).check_reminders()
    finally:
        conn.close()


@pytest.fixture
def two_due(client, clock):
    """Two made-up reminders that have come due (start date set first)."""
    client.get("/api/tasks")  # creates the Sample file
    run_check(clock)
    for title, at in (("Second", "2026-11-15T21:40"), ("First", "2026-11-15T21:30")):
        r = client.post(
            "/api/tasks", json={"title": title, "category": "personal", "reminder_at": at}
        )
        assert r.status_code == 201
    clock.now = START + timedelta(hours=1)
    run_check(clock)
    return client.get("/api/notifications").json()["items"]


def test_list_is_empty_at_first(client):
    response = client.get("/api/notifications")
    assert response.status_code == 200
    assert response.json() == {"mode": "sample", "items": []}


def test_list_shows_active_items_oldest_first_with_mode(client, two_due):
    body = client.get("/api/notifications").json()
    assert body["mode"] == "sample"
    assert [i["title"] for i in body["items"]] == ["First", "Second"]
    first = body["items"][0]
    assert set(first) == {"id", "kind", "task_id", "title", "due_at", "seen"}
    assert (first["kind"], first["due_at"], first["seen"]) == (
        "reminder",
        "2026-11-15T21:30",
        False,
    )


def test_seen_then_list_says_seen(client, two_due):
    nid = two_due[0]["id"]
    r = client.post(f"/api/notifications/{nid}/seen", json={"mode": "sample"})
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    assert client.get("/api/notifications").json()["items"][0]["seen"] is True


def test_dismiss_removes_it_from_the_list(client, two_due):
    nid = two_due[0]["id"]
    assert (
        client.post(f"/api/notifications/{nid}/dismiss", json={"mode": "sample"}).status_code == 200
    )
    assert [i["title"] for i in client.get("/api/notifications").json()["items"]] == ["Second"]


def test_dismiss_twice_is_409(client, two_due):
    nid = two_due[0]["id"]
    client.post(f"/api/notifications/{nid}/dismiss", json={"mode": "sample"})
    assert (
        client.post(f"/api/notifications/{nid}/dismiss", json={"mode": "sample"}).status_code == 409
    )


def test_unknown_id_is_404(client):
    client.get("/api/tasks")
    assert client.post("/api/notifications/999/seen", json={"mode": "sample"}).status_code == 404
    assert client.post("/api/notifications/999/dismiss", json={"mode": "sample"}).status_code == 404


def test_wrong_mode_is_409_and_changes_nothing(client, two_due):
    nid = two_due[0]["id"]
    for action in ("seen", "dismiss"):
        r = client.post(f"/api/notifications/{nid}/{action}", json={"mode": "personal"})
        assert r.status_code == 409
        assert "mode changed" in r.json()["detail"].lower()
    item = client.get("/api/notifications").json()["items"][0]
    assert (item["id"], item["seen"]) == (nid, False)


@pytest.mark.parametrize("body", [{}, {"mode": "sample", "extra": 1}, {"mode": "other"}])
def test_bad_body_is_422(client, two_due, body):
    nid = two_due[0]["id"]
    assert client.post(f"/api/notifications/{nid}/dismiss", json=body).status_code == 422


def test_list_does_not_run_the_check(client, clock):
    client.get("/api/tasks")
    run_check(clock)
    client.post(
        "/api/tasks",
        json={"title": "Due", "category": "personal", "reminder_at": "2026-11-15T21:30"},
    )
    clock.now = START + timedelta(hours=1)
    assert client.get("/api/notifications").json()["items"] == []


def test_missing_settings_is_503(tmp_path, monkeypatch):
    monkeypatch.setenv(config.DATA_DIR_ENV, str(tmp_path))
    client = TestClient(create_app(dev=False), base_url=APP_URL, headers={"origin": APP_URL})
    assert client.get("/api/notifications").status_code == 503


def test_list_names_the_database_it_actually_read_even_if_the_mode_switches_meanwhile(
    client, two_due, monkeypatch
):
    from aicity import notification_routes

    real_open = notification_routes.open_database

    def open_then_switch(path, kind):
        conn = real_open(path, kind)
        client.app.state.db_kind = DbKind.PERSONAL  # a switch lands mid-request
        return conn

    monkeypatch.setattr(notification_routes, "open_database", open_then_switch)
    body = client.get("/api/notifications").json()
    assert body["mode"] == "sample"
    assert [i["title"] for i in body["items"]] == ["First", "Second"]


def test_presence_is_reported_by_post(client):
    client.post("/api/notifications/presence", json={"looking": True})
    assert client.app.state.presence.looking() is True
    client.post("/api/notifications/presence", json={"looking": False})
    assert client.app.state.presence.looking() is False


def test_a_get_never_changes_presence(client):
    """Security audit 2026-11-26: GET skips the Origin rule, so it must not set presence."""
    client.get("/api/notifications?looking=1")
    assert client.app.state.presence.looking() is False


def test_presence_post_from_another_site_is_refused(data_dir, clock):
    app = create_app(dev=False)
    other = TestClient(app, base_url=APP_URL, headers={"origin": "https://evil.example"})
    assert other.post("/api/notifications/presence", json={"looking": True}).status_code == 403
