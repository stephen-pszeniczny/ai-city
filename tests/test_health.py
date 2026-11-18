"""Tests for the 'I'm alive' check and for keeping extra pages switched off."""

from fastapi.testclient import TestClient

from aicity.main import create_app

client = TestClient(create_app(dev=False), base_url="http://127.0.0.1:8765")


def test_health_says_ok():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_auto_generated_api_docs_are_off():
    # Unknown addresses now get the app's own page (or the "build it" note), so the
    # check is that FastAPI's generated API docs never come back, not a bare 404.
    for path in ("/docs", "/redoc", "/openapi.json"):
        response = client.get(path)
        text = response.text.lower()
        assert "swagger" not in text and "redoc" not in text and '"openapi"' not in text, path
        assert "application/json" not in response.headers.get("content-type", ""), path
