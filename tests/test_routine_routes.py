"""Tests for the routine web routes (src/aicity/routine_routes.py).

Fake clock: Sunday 2026-11-29 20:00 local. Each test gets a temporary data folder with
the example settings plus one made-up routine (Sunday to Thursday).
"""

import shutil
import sqlite3
from datetime import datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from aicity import config
from aicity.db import DbKind, db_path
from aicity.main import create_app

APP_URL = "http://127.0.0.1:8765"
EXAMPLE_SETTINGS = Path(__file__).resolve().parents[1] / "settings.example.toml"
SUNDAY_8PM = datetime(2026, 11, 29, 20, 0).astimezone()
ROUTINE = """
[[routines]]
id = "evening_prep"
title = "Evening prep"
days = ["sun", "mon", "tue", "wed", "thu"]
shows_from = "19:00"
remind_at = "21:30"
items = ["Lunch", "Bag"]
"""


class FakeClock:
    def __init__(self, now: datetime) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now


def _client(tmp_path, monkeypatch, *, routine=True, kind=DbKind.PERSONAL, now=SUNDAY_8PM):
    monkeypatch.setenv(config.DATA_DIR_ENV, str(tmp_path))
    (tmp_path / "settings").mkdir(exist_ok=True)
    target = tmp_path / "settings" / "settings.toml"
    shutil.copy(EXAMPLE_SETTINGS, target)
    if routine:
        target.write_text(target.read_text() + ROUTINE)
    app = create_app(dev=False)
    app.state.clock = FakeClock(now)
    app.state.db_kind = kind
    return TestClient(app, base_url=APP_URL, headers={"origin": APP_URL})


@pytest.fixture
def client(tmp_path, monkeypatch):
    return _client(tmp_path, monkeypatch)


def tick(client, item: str, ticked: bool = True, routine_id: str = "evening_prep"):
    return client.post(
        f"/api/plan/routines/{routine_id}/tick", json={"item": item, "ticked": ticked}
    )


def test_get_routines_reads_today(client):
    assert client.get("/api/plan/routines").json() == {
        "today": "2026-11-29",
        "routines": [
            {
                "id": "evening_prep",
                "title": "Evening prep",
                "shows_from": "19:00",
                "remind_at": "21:30",
                "items": [{"name": "Lunch", "ticked": False}, {"name": "Bag", "ticked": False}],
                "done": 0,
                "total": 2,
            }
        ],
    }


def test_tick_and_untick(client):
    assert tick(client, "Lunch").json()["done"] == 1
    assert tick(client, "Lunch", ticked=False).json()["done"] == 0
    assert client.get("/api/plan/routines").json()["routines"][0]["done"] == 0


def test_unknown_routine_is_404(client):
    assert tick(client, "Lunch", routine_id="morning").status_code == 404


def test_unknown_item_is_409(client):
    response = tick(client, "Socks")
    assert response.status_code == 409
    assert response.json() == {"detail": "That item isn't in the routine."}


def test_a_routine_that_does_not_run_today_is_409(tmp_path, monkeypatch):
    friday = _client(tmp_path, monkeypatch, now=datetime(2026, 11, 27, 20, 0).astimezone())
    assert friday.get("/api/plan/routines").json()["routines"] == []
    response = tick(friday, "Lunch")
    assert response.status_code == 409
    assert "doesn't run" in response.json()["detail"]


@pytest.mark.parametrize(
    "body", [{"item": "Lunch"}, {"item": "", "ticked": True}, {"ticked": True}]
)
def test_bad_tick_body_is_422(client, body):
    assert client.post("/api/plan/routines/evening_prep/tick", json=body).status_code == 422


def test_finishing_the_routine_clears_its_reminder(client):
    client.get("/api/plan/routines")  # makes the database
    with sqlite3.connect(db_path(DbKind.PERSONAL)) as conn:
        conn.execute(
            "INSERT INTO notifications (kind, routine_id, title, due_at, created_at) VALUES "
            "('routine', 'evening_prep', 'Evening prep: not done yet', '2026-11-29T19:30', "
            "'2026-11-29T19:30:00Z')"
        )
    tick(client, "Lunch")
    tick(client, "Bag")
    with sqlite3.connect(db_path(DbKind.PERSONAL)) as conn:
        cleared = conn.execute("SELECT cleared_at IS NOT NULL FROM notifications").fetchone()
    assert cleared == (1,)


def test_no_routines_in_settings(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch, routine=False)
    assert client.get("/api/plan/routines").json()["routines"] == []


def test_sample_mode_uses_its_own_routines(tmp_path, monkeypatch):
    client = _client(tmp_path, monkeypatch, routine=False, kind=DbKind.SAMPLE)
    routines = client.get("/api/plan/routines").json()["routines"]
    assert [r["id"] for r in routines] == ["evening_prep"]
