"""Tests for GET /api/daylight: is it night where the settings say we are.

Uses the example settings location (Greenwich) and a fixed clock. The answer
must never echo the location back: the page only needs day or night.
"""

import shutil
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from aicity import config
from aicity.main import create_app

APP_URL = "http://127.0.0.1:8765"
EXAMPLE_SETTINGS = Path(__file__).resolve().parents[1] / "settings.example.toml"
KEYS = {"is_night", "sunrise", "sunset", "next_change", "moon_phase"}


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv(config.DATA_DIR_ENV, str(tmp_path))
    return tmp_path


def client_at(now: datetime) -> TestClient:
    app = create_app(dev=False)
    app.state.clock = lambda: now
    return TestClient(app, base_url=APP_URL)


def with_settings(data_dir: Path) -> None:
    (data_dir / "settings").mkdir()
    shutil.copy(EXAMPLE_SETTINGS, data_dir / "settings" / "settings.toml")


def test_daytime_answer(data_dir):
    with_settings(data_dir)
    response = client_at(datetime(2026, 6, 21, 11, 0, tzinfo=UTC)).get("/api/daylight")

    assert response.status_code == 200
    body = response.json()
    assert body["is_night"] is False
    assert body["sunset"].startswith("2026-06-21T21:2")
    assert body["next_change"] == body["sunset"]
    assert 0 <= body["moon_phase"] < 1


def test_night_answer(data_dir):
    with_settings(data_dir)
    body = client_at(datetime(2026, 12, 21, 20, 0, tzinfo=UTC)).get("/api/daylight").json()

    assert body["is_night"] is True
    assert body["next_change"].startswith("2026-12-22T08:0")


def test_times_carry_their_offset(data_dir):
    with_settings(data_dir)
    body = client_at(datetime(2026, 6, 21, 11, 0, tzinfo=UTC)).get("/api/daylight").json()

    assert body["sunset"].endswith("+01:00")


def test_missing_settings_is_503(data_dir):
    response = client_at(datetime(2026, 6, 21, 11, 0, tzinfo=UTC)).get("/api/daylight")

    assert response.status_code == 503


def test_answer_has_no_location(data_dir):
    with_settings(data_dir)
    body = client_at(datetime(2026, 6, 21, 11, 0, tzinfo=UTC)).get("/api/daylight").json()

    assert set(body) == KEYS
    text = str(body).lower()
    assert "51.4" not in text and "london" not in text and "example town" not in text
