"""Tests for the front door lock (src/aicity/security.py).

Rule 1: requests must be addressed to the app on this Mac (Host header).
Rule 2: anything that could change data must come from the app's own page
        (Origin header). Dev-server origins count only in dev mode.
"""

import pytest
from fastapi.testclient import TestClient

from aicity import config
from aicity.main import create_app

APP_URL = "http://127.0.0.1:8765"
DEV_URL = "http://localhost:5173"
CHANGING_METHODS = ["POST", "PUT", "PATCH", "DELETE"]


def make_client(*, dev: bool) -> TestClient:
    """An app with one extra test-only address that accepts every method."""
    app = create_app(dev=dev)

    @app.api_route("/api/test-change", methods=["GET", "HEAD", *CHANGING_METHODS, "OPTIONS"])
    def test_change() -> dict[str, bool]:
        return {"reached": True}

    return TestClient(app, base_url=APP_URL)


@pytest.fixture
def client() -> TestClient:
    return make_client(dev=False)


@pytest.fixture
def dev_client() -> TestClient:
    return make_client(dev=True)


# --- Rule 1: Host ----------------------------------------------------------


@pytest.mark.parametrize("host", ["127.0.0.1:8765", "localhost:8765", "LOCALHOST:8765"])
def test_own_host_is_accepted(client, host):
    assert client.get("/api/health", headers={"host": host}).status_code == 200


@pytest.mark.parametrize(
    "host",
    [
        "evil.example.com",  # DNS rebinding: attacker's domain pointed at 127.0.0.1
        "evil.example.com:8765",
        "127.0.0.1",  # right machine, no port
        "127.0.0.1:9999",  # wrong port
        "127.0.0.1:8765.evil.example.com",
        "localhost:5173",  # dev server, but dev mode is off
        "",
    ],
)
def test_other_hosts_are_refused(client, host):
    response = client.get("/api/health", headers={"host": host})
    assert response.status_code == 400


def test_refusal_does_not_echo_the_header(client):
    response = client.get("/api/health", headers={"host": "evil.example.com"})
    assert "evil" not in response.text


def test_host_check_covers_unknown_addresses_too(client):
    response = client.get("/no-such-page", headers={"host": "evil.example.com"})
    assert response.status_code == 400


def test_dev_host_accepted_only_in_dev_mode(client, dev_client):
    headers = {"host": "localhost:5173"}
    assert client.get("/api/health", headers=headers).status_code == 400
    assert dev_client.get("/api/health", headers=headers).status_code == 200


# --- Rule 2: Origin --------------------------------------------------------


@pytest.mark.parametrize("method", CHANGING_METHODS)
def test_change_from_own_page_is_allowed(client, method):
    response = client.request(method, "/api/test-change", headers={"origin": APP_URL})
    assert response.status_code == 200
    assert response.json() == {"reached": True}


@pytest.mark.parametrize("method", CHANGING_METHODS + ["OPTIONS"])
def test_change_without_origin_is_refused(client, method):
    response = client.request(method, "/api/test-change")
    assert response.status_code == 403


@pytest.mark.parametrize(
    "origin",
    [
        "https://evil.example.com",
        "http://127.0.0.1:8765.evil.example.com",
        "https://127.0.0.1:8765",  # wrong scheme
        "http://127.0.0.1:9999",
        "null",  # sent by sandboxed pages and local files
        DEV_URL,  # dev server, but dev mode is off
    ],
)
def test_change_from_other_page_is_refused(client, origin):
    response = client.post("/api/test-change", headers={"origin": origin})
    assert response.status_code == 403


def test_dev_origin_allowed_only_in_dev_mode(client, dev_client):
    headers = {"host": "localhost:5173", "origin": DEV_URL}
    assert client.post("/api/test-change", headers=headers).status_code == 400
    assert dev_client.post("/api/test-change", headers=headers).status_code == 200


@pytest.mark.parametrize("method", ["GET", "HEAD"])
def test_reading_needs_no_origin(client, method):
    assert client.request(method, "/api/test-change").status_code == 200


def test_refused_request_never_reaches_the_app(client):
    response = client.post("/api/test-change", headers={"origin": "https://evil.example.com"})
    assert "reached" not in response.text


def test_header_sent_twice_is_refused(client):
    response = client.post(
        "/api/test-change",
        headers=[("origin", APP_URL), ("origin", "https://evil.example.com")],
    )
    assert response.status_code == 403


# --- Dev switch ------------------------------------------------------------


@pytest.mark.parametrize(
    ("value", "expected"),
    [("1", True), (" 1 ", True), ("0", False), ("true", False), ("yes", False), ("", False)],
)
def test_dev_mode_needs_exactly_1(monkeypatch, value, expected):
    monkeypatch.setenv(config.DEV_ENV, value)
    assert config.dev_mode() is expected


def test_dev_mode_off_when_unset(monkeypatch):
    monkeypatch.delenv(config.DEV_ENV, raising=False)
    assert config.dev_mode() is False
