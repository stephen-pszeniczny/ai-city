"""Tests for the app launcher (scripts/run_app.py).

The server is never really started here: uvicorn.run is swapped for a
recorder, so the tests see exactly what the launcher would have started.
"""

import importlib.util
from pathlib import Path

import pytest

from aicity import config

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "run_app.py"
_spec = importlib.util.spec_from_file_location("run_app", SCRIPT)
run_app = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(run_app)


@pytest.fixture
def started(monkeypatch):
    """Replace uvicorn.run with a recorder; returns the list of calls."""
    calls = []
    monkeypatch.setattr(run_app.uvicorn, "run", lambda app, **kw: calls.append((app, kw)))
    return calls


def test_starts_the_app_on_config_host_and_port(started):
    run_app.main()
    [(app, kwargs)] = started
    assert kwargs["host"] == config.HOST == "127.0.0.1"
    assert kwargs["port"] == config.PORT
    assert app.title == "AI City"


def test_port_really_comes_from_config(started, monkeypatch):
    monkeypatch.setattr(config, "PORT", 9123)
    run_app.main()
    assert started[0][1]["port"] == 9123


@pytest.mark.parametrize(
    "host",
    [
        "0.0.0.0",  # every network the Mac is on
        "::",  # same, IPv6
        "192.168.1.20",  # home network address
        "localhost",  # usually this Mac, but depends on system settings
        "",
    ],
)
def test_refuses_to_start_on_anything_but_this_mac(started, monkeypatch, host):
    monkeypatch.setattr(config, "HOST", host)
    with pytest.raises(SystemExit, match="this Mac only"):
        run_app.main()
    assert started == []
