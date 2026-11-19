"""Tests for the Daily plan web routes (src/aicity/plan_routes.py).

Each test gets its own temporary data folder with the example settings file plus a
made-up [plan] section, and a fake clock on Wednesday 2026-11-25 (local time).
Requests carry the app's own Origin header, as the real page would.
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
# Noon local time on a Wednesday, so "today" is the 25th in any Mac time zone.
NOW = datetime(2026, 11, 25, 12, 0).astimezone()
PLAN = """
[plan]

[[plan.blocks]]
title = "Work"
kind = "work"
days = ["mon", "tue", "wed", "thu", "fri"]
start = "09:00"
end = "12:00"

[[plan.blocks]]
title = "Gym"
kind = "gym"
days = ["mon", "tue", "wed", "thu", "fri"]
start = "12:00"
end = "13:00"
"""


class FakeClock:
    def __init__(self) -> None:
        self.now = NOW

    def __call__(self) -> datetime:
        return self.now


def _data_dir(tmp_path, monkeypatch, with_plan: bool) -> Path:
    monkeypatch.setenv(config.DATA_DIR_ENV, str(tmp_path))
    (tmp_path / "settings").mkdir()
    target = tmp_path / "settings" / "settings.toml"
    shutil.copy(EXAMPLE_SETTINGS, target)
    if with_plan:
        target.write_text(target.read_text() + PLAN)
    return tmp_path


def _client(kind: DbKind = DbKind.PERSONAL) -> TestClient:
    app = create_app(dev=False)
    app.state.clock = FakeClock()
    app.state.db_kind = kind
    return TestClient(app, base_url=APP_URL, headers={"origin": APP_URL})


@pytest.fixture
def client(tmp_path, monkeypatch):
    _data_dir(tmp_path, monkeypatch, with_plan=True)
    return _client()


def weeks_saved(kind: DbKind = DbKind.PERSONAL) -> int:
    path = db_path(kind)
    if not path.exists():
        return 0
    with sqlite3.connect(path) as conn:
        return conn.execute("SELECT count(*) FROM plan_weeks").fetchone()[0]


def opened(client, start="2026-11-23") -> dict:
    response = client.post(f"/api/plan/week/{start}/open")
    assert response.status_code == 200, response.text
    return response.json()


def block_of(week: dict, day: str, title: str) -> dict:
    blocks = next(d["blocks"] for d in week["days"] if d["day"] == day)
    return next(b for b in blocks if b["title"] == title)


# --- Reading and opening a week ---------------------------------------------------


def test_get_week_reads_only_and_open_creates(client):
    before = client.get("/api/plan/week?start=2026-11-23").json()
    assert before == {
        "configured": True,
        "week_start": "2026-11-23",
        "today": "2026-11-25",
        "exists": False,
        "checked_in": False,
        "grocery_day": None,
        "days": [],
    }
    week = opened(client)
    assert week["exists"] is True
    assert [d["day"] for d in week["days"]] == [f"2026-11-{n}" for n in range(23, 30)]
    assert client.get("/api/plan/week?start=2026-11-23").json() == week
    assert weeks_saved() == 1


def test_get_week_defaults_to_this_week(client):
    assert client.get("/api/plan/week").json()["week_start"] == "2026-11-23"


def test_block_json_fields(client):
    gym = block_of(opened(client), "2026-11-25", "Gym")
    assert set(gym) == {"id", "day", "start", "end", "title", "kind", "source", "status", "edited"}
    assert (gym["start"], gym["end"], gym["kind"], gym["source"], gym["status"], gym["edited"]) == (
        "12:00",
        "13:00",
        "gym",
        "settings",
        "planned",
        False,
    )


def test_no_plan_section(tmp_path, monkeypatch):
    _data_dir(tmp_path, monkeypatch, with_plan=False)
    client = _client()
    assert client.get("/api/plan/week").json()["configured"] is False
    week = opened(client)
    assert (week["configured"], week["exists"], week["days"]) == (False, False, [])
    rebuilt = client.post("/api/plan/week/2026-11-23/rebuild").json()
    assert (rebuilt["configured"], rebuilt["exists"]) == (False, False)
    assert weeks_saved() == 0


def test_far_weeks_are_not_created(client):
    assert opened(client, "2026-12-07")["exists"] is False
    assert opened(client, "2026-11-16")["exists"] is False
    assert opened(client, "2026-11-30")["exists"] is True
    assert weeks_saved() == 1


@pytest.mark.parametrize("start", ["2026-11-24", "2026-02-30", "soon"])
def test_bad_week_start_is_422(client, start):
    assert client.post(f"/api/plan/week/{start}/open").status_code == 422
    assert client.get(f"/api/plan/week?start={start}").status_code == 422


# --- Blocks -----------------------------------------------------------------------

HOCKEY = {
    "week_start": "2026-11-23",
    "day": "2026-11-26",
    "start": "21:00",
    "end": "22:00",
    "title": "Hockey",
    "kind": "event",
}


def test_block_routes(client):
    opened(client)
    response = client.post("/api/plan/blocks", json=HOCKEY)
    assert response.status_code == 201, response.text
    hockey = response.json()
    assert (hockey["title"], hockey["source"], hockey["edited"]) == ("Hockey", "added", False)

    edited = client.patch(f"/api/plan/blocks/{hockey['id']}", json={"start": "20:30"}).json()
    assert edited["start"] == "20:30"

    removed = client.post(f"/api/plan/blocks/{hockey['id']}/remove").json()
    assert removed["status"] == "removed"

    week = client.get("/api/plan/week").json()
    gym = block_of(week, "2026-11-25", "Gym")
    done = client.post(f"/api/plan/blocks/{gym['id']}/gym", json={"status": "done"}).json()
    assert done["status"] == "done"


def test_rebuild_route(client):
    week = opened(client)
    work = block_of(week, "2026-11-26", "Work")
    client.post(f"/api/plan/blocks/{work['id']}/remove")
    rebuilt = client.post("/api/plan/week/2026-11-23/rebuild").json()
    thursday = next(d["blocks"] for d in rebuilt["days"] if d["day"] == "2026-11-26")
    assert [b["title"] for b in thursday] == ["Gym"]


def test_past_day_edit_is_409(client):
    week = opened(client)
    monday_work = block_of(week, "2026-11-23", "Work")
    response = client.patch(f"/api/plan/blocks/{monday_work['id']}", json={"title": "X"})
    assert response.status_code == 409
    assert response.json() == {"detail": "Past days can't be changed."}


def test_future_gym_is_409(client):
    thursday_gym = block_of(opened(client), "2026-11-26", "Gym")
    response = client.post(f"/api/plan/blocks/{thursday_gym['id']}/gym", json={"status": "done"})
    assert response.status_code == 409


def test_unknown_block_is_404(client):
    opened(client)
    assert client.patch("/api/plan/blocks/999", json={"title": "X"}).status_code == 404
    assert client.post("/api/plan/blocks/999/remove").status_code == 404


def test_adding_to_an_unsaved_week_is_409(client):
    assert client.post("/api/plan/blocks", json=HOCKEY).status_code == 409


@pytest.mark.parametrize(
    "change",
    [
        pytest.param({"end": "20:00"}, id="end before start"),
        pytest.param({"end": "21:00"}, id="end equals start"),
        pytest.param({"start": "7:30"}, id="short time"),
        pytest.param({"end": "24:00"}, id="24:00"),
        pytest.param({"title": "   "}, id="blank title"),
        pytest.param({"title": "x" * 101}, id="long title"),
        pytest.param({"kind": "nap"}, id="unknown kind"),
        pytest.param({"day": "2026-02-30"}, id="no such day"),
        pytest.param({"status": "done"}, id="extra field"),
    ],
)
def test_bad_block_is_422(client, change):
    opened(client)
    assert client.post("/api/plan/blocks", json=HOCKEY | change).status_code == 422


def test_bad_edit_is_422(client):
    work = block_of(opened(client), "2026-11-26", "Work")
    assert client.patch(f"/api/plan/blocks/{work['id']}", json={"kind": "nap"}).status_code == 422
    assert client.patch(f"/api/plan/blocks/{work['id']}", json={"end": "08:00"}).status_code == 409
    assert client.patch(f"/api/plan/blocks/{work['id']}", json={"title": None}).status_code == 422


@pytest.mark.parametrize("status", ["removed", "replaced", "finished"])
def test_bad_gym_status_is_422(client, status):
    gym = block_of(opened(client), "2026-11-25", "Gym")
    response = client.post(f"/api/plan/blocks/{gym['id']}/gym", json={"status": status})
    assert response.status_code == 422


# --- Sample mode ------------------------------------------------------------------


def test_sample_mode_uses_its_own_plan(tmp_path, monkeypatch):
    _data_dir(tmp_path, monkeypatch, with_plan=False)
    client = _client(DbKind.SAMPLE)
    week = opened(client)
    assert (week["configured"], week["exists"]) == (True, True)
    assert weeks_saved(DbKind.PERSONAL) == 0


# --- Sunday check-in ----------------------------------------------------------------

SUNDAY_1PM = datetime(2026, 11, 29, 13, 0).astimezone()
USUAL = """
[[plan.usual_events]]
title = "Hockey"
day = "thu"
start = "21:00"
end = "22:00"

[[plan.usual_events]]
title = "Games night"
start = "19:00"
end = "21:00"
"""


@pytest.fixture
def sunday(tmp_path, monkeypatch):
    path = _data_dir(tmp_path, monkeypatch, with_plan=True) / "settings" / "settings.toml"
    path.write_text(path.read_text() + USUAL)
    client = _client()
    client.app.state.clock.now = SUNDAY_1PM
    return client


def test_checkin_status_reads_only(sunday):
    status = sunday.get("/api/plan/checkin").json()
    assert status == {
        "configured": True,
        "week_start": "2026-11-30",
        "due": True,
        "checked_in": False,
        "opens": "12:00",
        "usual_events": [
            {
                "title": "Hockey",
                "kind": "event",
                "day": "2026-12-03",
                "start": "21:00",
                "end": "22:00",
            },
            {
                "title": "Games night",
                "kind": "event",
                "day": None,
                "start": "19:00",
                "end": "21:00",
            },
        ],
    }
    assert weeks_saved() == 0


def test_checkin_open_creates_the_coming_week(sunday):
    week = sunday.post("/api/plan/checkin/open").json()
    assert (week["week_start"], week["exists"], week["grocery_day"]) == ("2026-11-30", True, None)
    assert [e["title"] for e in week["usual_events"]] == ["Hockey", "Games night"]
    assert weeks_saved() == 1


def test_grocery_day_route(sunday):
    sunday.post("/api/plan/checkin/open")
    url = "/api/plan/week/2026-11-30/grocery-day"
    assert sunday.post(url, json={"day": "2026-12-02"}).json()["grocery_day"] == "2026-12-02"
    assert sunday.post(url, json={"day": None}).json()["grocery_day"] is None
    outside = sunday.post(url, json={"day": "2026-12-07"})
    assert outside.status_code == 409
    assert "today or later" in outside.json()["detail"]
    assert sunday.post(url, json={"day": "soon"}).status_code == 422


def test_finish_twice_keeps_the_first_time_and_clears_the_reminder(sunday):
    sunday.post("/api/plan/checkin/open")
    conn = sqlite3.connect(db_path(DbKind.PERSONAL))
    conn.execute(
        "INSERT INTO notifications (kind, title, due_at, created_at) "
        "VALUES ('checkin', 'x', '2026-11-29T16:00', '2026-11-29T16:00:00Z')"
    )
    conn.commit()
    first = sunday.post("/api/plan/week/2026-11-30/checkin").json()
    assert first["checked_in"] is True
    stamp = conn.execute("SELECT checked_in_at FROM plan_weeks").fetchone()[0]
    sunday.app.state.clock.now = datetime(2026, 11, 29, 18, 0).astimezone()
    sunday.post("/api/plan/week/2026-11-30/checkin")
    assert conn.execute("SELECT checked_in_at FROM plan_weeks").fetchone()[0] == stamp
    assert conn.execute("SELECT cleared_at IS NOT NULL FROM notifications").fetchone() == (1,)
    status = sunday.get("/api/plan/checkin").json()
    assert (status["due"], status["checked_in"]) == (False, True)
    conn.close()


def test_week_json_has_grocery_day(client):
    assert opened(client)["grocery_day"] is None


def test_checkin_without_a_plan(tmp_path, monkeypatch):
    _data_dir(tmp_path, monkeypatch, with_plan=False)
    client = _client()
    status = client.get("/api/plan/checkin").json()
    assert (status["configured"], status["due"]) == (False, False)
    opened_ = client.post("/api/plan/checkin/open").json()
    assert (opened_["configured"], opened_["exists"]) == (False, False)
    assert client.post("/api/plan/week/2026-11-23/checkin").json()["configured"] is False
    assert weeks_saved() == 0


def test_checkin_in_sample_mode(tmp_path, monkeypatch):
    _data_dir(tmp_path, monkeypatch, with_plan=False)
    client = _client(DbKind.SAMPLE)
    assert client.post("/api/plan/checkin/open").json()["exists"] is True
