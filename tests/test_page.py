"""Tests for serving the built page (src/aicity/page.py).

In normal mode the backend serves frontend/dist itself, so the app needs no
dev server. Every non-/api address gets the page (its own router handles
/b/<id> and the rest); files only ever come from inside dist/assets.
"""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from aicity import config
from aicity.main import create_app

APP_URL = "http://127.0.0.1:8765"


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv(config.DATA_DIR_ENV, str(tmp_path / "data"))
    return tmp_path / "data"


@pytest.fixture
def dist(tmp_path) -> Path:
    d = tmp_path / "dist"
    (d / "assets").mkdir(parents=True)
    (d / "index.html").write_text("<!doctype html><title>Asteroid Belt</title>")
    (d / "assets" / "app.js").write_text("console.log('hi')")
    (tmp_path / "secret.txt").write_text("not for the page")
    return d


def client(dist: Path, dev: bool = False) -> TestClient:
    return TestClient(create_app(dev=dev, dist=dist), base_url=APP_URL)


def test_root_serves_the_page(data_dir, dist):
    r = client(dist).get("/")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
    assert "<title>Asteroid Belt</title>" in r.text


@pytest.mark.parametrize("path", ["/b/planner", "/b/planner/screen", "/todo"])
def test_deep_links_serve_the_page(data_dir, dist, path):
    r = client(dist).get(path)
    assert r.status_code == 200
    assert "<title>Asteroid Belt</title>" in r.text


def test_assets_are_served_with_their_type(data_dir, dist):
    r = client(dist).get("/assets/app.js")
    assert r.status_code == 200
    assert "javascript" in r.headers["content-type"]
    assert r.text == "console.log('hi')"


def test_missing_asset_is_404(data_dir, dist):
    assert client(dist).get("/assets/nope.js").status_code == 404


@pytest.mark.parametrize(
    "path",
    [
        "/assets/../../secret.txt",
        "/assets/%2e%2e/%2e%2e/secret.txt",
        "/assets/..%2f..%2fsecret.txt",
    ],
)
def test_path_escape_is_refused(data_dir, dist, path):
    r = client(dist).get(path)
    assert "not for the page" not in r.text
    assert r.status_code in (404, 200)
    if (
        r.status_code == 200
    ):  # normalised by the client to a page route: must be the page, not the file
        assert "<title>Asteroid Belt</title>" in r.text


def test_api_routes_still_answer(data_dir, dist):
    c = client(dist)
    assert c.get("/api/health").json() == {"status": "ok"}
    r = c.get("/api/nope")
    assert r.status_code == 404
    assert "<title>" not in r.text


def test_missing_build_says_how_to_build(data_dir, tmp_path):
    r = client(tmp_path / "no-dist").get("/")
    assert r.status_code == 503
    assert "npm run build" in r.text


def test_dev_mode_does_not_serve_the_page(data_dir, dist):
    assert client(dist, dev=True).get("/").status_code == 404


def test_the_page_is_never_kept_stale(data_dir, dist):
    # After an update the old page would point at deleted files: always re-check it.
    r = client(dist).get("/b/planner")
    assert r.headers.get("cache-control") == "no-cache"
