"""Tests for the 'I'm alive' check and for keeping extra pages switched off."""

from fastapi.testclient import TestClient

from aicity.main import app

client = TestClient(app)


def test_health_says_ok():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_auto_generated_api_docs_are_off():
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404, path
