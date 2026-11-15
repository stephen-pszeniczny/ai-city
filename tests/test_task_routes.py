"""Tests for the to-do list web routes (src/aicity/task_routes.py).

Each test gets its own temporary data folder with the example settings file
(stale_after_days = 14), and a fake clock. Requests carry the app's own
Origin header, as the real page would.
"""

import shutil
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from aicity import config
from aicity.db import DbKind, db_path
from aicity.main import create_app

APP_URL = "http://127.0.0.1:8765"
EXAMPLE_SETTINGS = Path(__file__).resolve().parents[1] / "settings.example.toml"
START = datetime(2026, 11, 15, 21, 0, 0, tzinfo=UTC)
EXAMPLE_STALE_DAYS = 14


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


def new_task(client, **overrides):
    body = {"title": "Example", "category": "personal", **overrides}
    response = client.post("/api/tasks", json=body)
    assert response.status_code == 201, response.text
    return response.json()


# --- Create and read -----------------------------------------------------------


def test_create_returns_201_and_the_task(client):
    task = new_task(client, notes="n", goal_date="2026-12-01", reminder_at="2026-11-30T09:00")
    assert task["id"] > 0
    assert task["title"] == "Example"
    assert task["status"] == "open"
    assert task["goal_date"] == "2026-12-01"
    assert task["reminder_at"] == "2026-11-30T09:00"
    assert task["created_at"] == "2026-11-15T21:00:00Z"
    assert task["stale"] is False


def test_get_one_task(client):
    task = new_task(client)
    response = client.get(f"/api/tasks/{task['id']}")
    assert response.status_code == 200
    assert response.json() == task


def test_list_filters_by_status(client):
    a = new_task(client, title="A")
    b = new_task(client, title="B")
    client.post(f"/api/tasks/{b['id']}/complete")
    assert [t["title"] for t in client.get("/api/tasks").json()] == ["A"]
    assert [t["title"] for t in client.get("/api/tasks?status=done").json()] == ["B"]
    assert len(client.get("/api/tasks?status=all").json()) == 2
    assert a["id"] != b["id"]


def test_list_unknown_status_is_422(client):
    assert client.get("/api/tasks?status=deleted").status_code == 422


# --- Bad input is refused --------------------------------------------------------


@pytest.mark.parametrize(
    "body",
    [
        pytest.param({"category": "work"}, id="no title"),
        pytest.param({"title": "   ", "category": "work"}, id="blank title"),
        pytest.param({"title": "x" * 201, "category": "work"}, id="title too long"),
        pytest.param({"title": "x", "category": "other"}, id="unknown category"),
        pytest.param({"title": "x"}, id="no category"),
        pytest.param({"title": "x", "category": "work", "notes": "x" * 5001}, id="notes long"),
        pytest.param({"title": "x", "category": "work", "goal_date": "soon"}, id="text date"),
        pytest.param({"title": "x", "category": "work", "goal_date": "2026-02-30"}, id="no day"),
        pytest.param(
            {"title": "x", "category": "work", "reminder_at": "2026-11-30 09:00"}, id="reminder"
        ),
        pytest.param({"title": "x", "category": "work", "status": "done"}, id="extra field"),
        pytest.param({"title": 5, "category": "work"}, id="number title"),
    ],
)
def test_bad_create_is_422_and_nothing_saved(client, body):
    assert client.post("/api/tasks", json=body).status_code == 422
    assert client.get("/api/tasks?status=all").json() == []


@pytest.mark.parametrize(
    ("field", "value", "wording"),
    [
        ("goal_date", "2026-02-30", "isn't a real calendar date"),
        ("goal_date", "2026-13-01", "isn't a real calendar date"),
        ("reminder_at", "2026-11-30T25:00", "isn't a real date and time"),
        ("reminder_at", "2026-02-30T09:00", "isn't a real date and time"),
    ],
)
def test_impossible_dates_get_a_clear_message(client, field, value, wording):
    response = client.post("/api/tasks", json={"title": "x", "category": "work", field: value})
    assert response.status_code == 422
    assert wording in response.text
    task = new_task(client)
    response = client.patch(f"/api/tasks/{task['id']}", json={field: value})
    assert response.status_code == 422
    assert wording in response.text


# --- Edit ------------------------------------------------------------------------


def test_patch_changes_only_given_fields(client):
    task = new_task(client, notes="keep me", goal_date="2026-12-01")
    response = client.patch(f"/api/tasks/{task['id']}", json={"title": "New"})
    assert response.status_code == 200
    edited = response.json()
    assert (edited["title"], edited["notes"], edited["goal_date"]) == (
        "New",
        "keep me",
        "2026-12-01",
    )


def test_patch_null_clears_a_date(client):
    task = new_task(client, goal_date="2026-12-01")
    edited = client.patch(f"/api/tasks/{task['id']}", json={"goal_date": None}).json()
    assert edited["goal_date"] is None


@pytest.mark.parametrize(
    "body",
    [
        pytest.param({"title": None}, id="null title"),
        pytest.param({"category": None}, id="null category"),
        pytest.param({"notes": None}, id="null notes"),
        pytest.param({"title": ""}, id="empty title"),
        pytest.param({"status": "done"}, id="status not editable here"),
        pytest.param({"id": 7}, id="id not editable"),
    ],
)
def test_bad_patch_is_422_and_task_unchanged(client, body):
    task = new_task(client)
    assert client.patch(f"/api/tasks/{task['id']}", json=body).status_code == 422
    assert client.get(f"/api/tasks/{task['id']}").json() == task


@pytest.mark.parametrize("field", ["title", "category", "notes"])
def test_clearing_a_required_field_is_stopped_at_the_door(client, field):
    # The input check refuses it with a clear reason, before the database is reached.
    task = new_task(client)
    response = client.patch(f"/api/tasks/{task['id']}", json={field: None})
    assert response.status_code == 422
    assert f"{field} can't be cleared" in response.text


# --- Status changes ------------------------------------------------------------------


def test_complete_reopen_archive_cycle(client):
    task = new_task(client)
    tid = task["id"]
    assert client.post(f"/api/tasks/{tid}/complete").json()["status"] == "done"
    assert client.post(f"/api/tasks/{tid}/archive").json()["status"] == "archived"
    assert client.post(f"/api/tasks/{tid}/reopen").json()["status"] == "open"


@pytest.mark.parametrize(
    ("first", "second"),
    [("complete", "complete"), ("archive", "archive"), ("archive", "complete")],
)
def test_status_change_not_allowed_is_409(client, first, second):
    tid = new_task(client)["id"]
    client.post(f"/api/tasks/{tid}/{first}")
    response = client.post(f"/api/tasks/{tid}/{second}")
    assert response.status_code == 409
    assert "can't" in response.json()["detail"]


def test_editing_archived_task_is_409(client):
    tid = new_task(client)["id"]
    client.post(f"/api/tasks/{tid}/archive")
    assert client.patch(f"/api/tasks/{tid}", json={"title": "x"}).status_code == 409


def test_there_is_no_delete_route(client):
    tid = new_task(client)["id"]
    assert client.delete(f"/api/tasks/{tid}").status_code == 405
    assert client.get(f"/api/tasks/{tid}").status_code == 200


# --- Missing tasks ---------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/tasks/999"),
        ("PATCH", "/api/tasks/999"),
        ("POST", "/api/tasks/999/complete"),
        ("POST", "/api/tasks/999/reopen"),
        ("POST", "/api/tasks/999/archive"),
        ("GET", "/api/tasks/999/history"),
    ],
)
def test_missing_task_is_404(client, method, path):
    response = client.request(method, path, json={"title": "x"} if method == "PATCH" else None)
    assert response.status_code == 404
    assert response.json() == {"detail": "Task not found."}


def test_non_number_id_is_422(client):
    assert client.get("/api/tasks/abc").status_code == 422


# --- History and stale -----------------------------------------------------------------


def test_history_route(client):
    tid = new_task(client, title="Old")["id"]
    client.patch(f"/api/tasks/{tid}", json={"title": "New"})
    client.post(f"/api/tasks/{tid}/complete")
    events = client.get(f"/api/tasks/{tid}/history").json()
    assert [e["kind"] for e in events] == ["created", "edited", "completed"]
    assert events[1]["changes"] == {"title": ["Old", "New"]}
    assert events[0]["at"] == "2026-11-15T21:00:00Z"


def test_stale_uses_the_settings_file_threshold(client, clock):
    tid = new_task(client)["id"]
    clock.now = START + timedelta(days=EXAMPLE_STALE_DAYS, seconds=-1)
    assert client.get(f"/api/tasks/{tid}").json()["stale"] is False
    clock.now = START + timedelta(days=EXAMPLE_STALE_DAYS)
    assert client.get(f"/api/tasks/{tid}").json()["stale"] is True


# --- Which database is used --------------------------------------------------------------


def test_routes_use_the_sample_database_only(client, data_dir):
    new_task(client)
    assert db_path(DbKind.SAMPLE).exists()
    assert not db_path(DbKind.PERSONAL).exists()


def test_missing_settings_file_is_503_with_a_clear_message(client, data_dir):
    (data_dir / "settings" / "settings.toml").unlink()
    response = client.get("/api/tasks")
    assert response.status_code == 503
    assert "init_data_dir.py" in response.json()["detail"]


# --- Front door still applies ----------------------------------------------------------


def test_create_without_origin_header_is_refused(data_dir, clock):
    bare = TestClient(create_app(dev=False), base_url=APP_URL)
    assert bare.post("/api/tasks", json={"title": "x", "category": "work"}).status_code == 403
