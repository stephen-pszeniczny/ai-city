"""Regression tests for the fixes from the 2026-11-26 security audit (quick profile)."""

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from aicity import config
from aicity.db import DbKind
from aicity.main import create_app
from aicity.mode import OwnerCheck
from aicity.statement_csv import StatementError, read_statement
from aicity.statement_import import MAX_PENDING, PendingImports

APP_URL = "http://127.0.0.1:8765"
HEADER = b"date,transaction,description,amount,balance,currency\n"


@pytest.fixture
def app(tmp_path, monkeypatch):
    monkeypatch.setenv(config.DATA_DIR_ENV, str(tmp_path))
    return create_app(dev=False, ask=lambda: OwnerCheck.CONFIRMED)


def test_statement_dates_before_2000_are_refused():
    with pytest.raises(StatementError, match="line 2"):
        read_statement(HEADER + b"0001-01-01,Deposit,NIMBUS LABS,10.00,,CAD\n")
    rows = read_statement(HEADER + b"2026-11-02,Deposit,NIMBUS LABS,10.00,,CAD\n")
    assert len(rows) == 1


def test_chunked_upload_over_2mb_is_refused_while_reading(app):
    client = TestClient(app, base_url=APP_URL, headers={"origin": APP_URL})

    def body():  # a generator body is sent chunked, with no Content-Length
        yield HEADER
        for _ in range(40):
            yield b"x" * 65536

    response = client.post("/api/vault/statements/preview", content=body())
    assert response.status_code == 413


def test_pending_previews_are_capped_and_swept():
    now = [datetime(2026, 11, 26, 12, tzinfo=UTC)]
    store = PendingImports(lambda: now[0])
    made = lambda: SimpleNamespace(created=now[0], kind=DbKind.SAMPLE)
    for _ in range(MAX_PENDING + 10):
        store.put(made())
    assert len(store._items) == MAX_PENDING
    now[0] += timedelta(minutes=16)
    store.put(made())
    assert len(store._items) == 1  # the expired ones were swept


@pytest.mark.parametrize("module", ["aicity.vault_routes", "aicity.jobs_routes"])
def test_key_check_and_database_open_use_one_mode(module):
    """A switch to Personal landing after the key check must not change the request's mode."""
    import importlib

    routes = importlib.import_module(module)
    app_state = SimpleNamespace(db_kind=DbKind.SAMPLE)
    request = SimpleNamespace(
        app=SimpleNamespace(state=app_state), state=SimpleNamespace(), headers={}
    )
    routes._require_key(request)  # Sample: no key needed
    app_state.db_kind = DbKind.PERSONAL  # the owner's switch lands now
    assert routes._kind(request) == DbKind.SAMPLE
    assert routes._sample(request) is True


def test_touch_id_prompt_names_the_operation(monkeypatch, tmp_path):
    from aicity import mode

    helper = tmp_path / "confirm-owner"
    helper.write_text("")
    calls = []
    monkeypatch.setattr(
        mode.subprocess,
        "run",
        lambda argv, **kw: calls.append(argv) or SimpleNamespace(returncode=0),
    )
    assert mode.ask_owner(helper, operation="vault") == OwnerCheck.CONFIRMED
    assert mode.ask_owner(helper) == OwnerCheck.CONFIRMED
    assert [c[1] for c in calls] == ["vault", "mode"]
