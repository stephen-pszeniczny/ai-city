"""Tests for GET /api/buildings: the nine buildings with their display names.

The 3D belt labels each building from this answer, so names must come from
the settings file (never from code), in the fixed ID order, and a broken
settings file must give a clear error rather than made-up names.
"""

import shutil
import tomllib
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from aicity import config
from aicity.main import create_app
from aicity.settings import BUILDING_IDS

APP_URL = "http://127.0.0.1:8765"
EXAMPLE_SETTINGS = Path(__file__).resolve().parents[1] / "settings.example.toml"


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv(config.DATA_DIR_ENV, str(tmp_path))
    return tmp_path


def client() -> TestClient:
    return TestClient(create_app(dev=False), base_url=APP_URL)


def test_buildings_lists_all_nine_in_order(data_dir):
    (data_dir / "settings").mkdir()
    shutil.copy(EXAMPLE_SETTINGS, data_dir / "settings" / "settings.toml")
    expected_names = tomllib.loads(EXAMPLE_SETTINGS.read_text())["buildings"]

    response = client().get("/api/buildings")

    assert response.status_code == 200
    body = response.json()
    assert [b["id"] for b in body] == list(BUILDING_IDS)
    assert {b["id"]: b["name"] for b in body} == expected_names
    assert all(set(b) == {"id", "name"} for b in body)


def test_buildings_follow_renamed_settings(data_dir):
    (data_dir / "settings").mkdir()
    text = EXAMPLE_SETTINGS.read_text().replace(
        'planner = "Mission Control"', 'planner = "Town Hall"'
    )
    (data_dir / "settings" / "settings.toml").write_text(text)

    body = client().get("/api/buildings").json()

    assert body[0] == {"id": "planner", "name": "Town Hall"}


def test_buildings_missing_settings_is_503(data_dir):
    response = client().get("/api/buildings")

    assert response.status_code == 503
    assert "settings" in response.json()["detail"].lower()
