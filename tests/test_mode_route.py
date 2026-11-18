"""Tests for the Personal / Sample switch: GET and PUT /api/mode (src/aicity/mode.py).

The rule that matters most: the app never moves to Personal (real data)
unless the Touch ID check clearly answers "confirmed". The real check is
replaced with a fake here; the real prompt is tried by hand on the Mac.
Each test gets its own data folder, so a saved mode never leaks between tests.
"""

import os
import stat
import threading

import pytest
from fastapi.testclient import TestClient

from aicity import config
from aicity.db import DbKind
from aicity.main import create_app
from aicity.mode import (
    OwnerCheck,
    ask_owner,
    load_saved_mode,
    save_mode,
    saved_mode_path,
)

APP_URL = "http://127.0.0.1:8765"


@pytest.fixture(autouse=True)
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv(config.DATA_DIR_ENV, str(tmp_path))
    return tmp_path


class FakeOwner:
    """Stands in for the Touch ID prompt: answers what it's told, counts the asks."""

    def __init__(self, answer: OwnerCheck = OwnerCheck.CONFIRMED) -> None:
        self.answer = answer
        self.asked = 0

    def __call__(self) -> OwnerCheck:
        self.asked += 1
        return self.answer


def make_client(owner: FakeOwner | None = None) -> TestClient:
    app = create_app(dev=False, ask=owner or FakeOwner())
    return TestClient(app, base_url=APP_URL, headers={"origin": APP_URL})


def switch(client: TestClient, mode: str):
    return client.put("/api/mode", json={"mode": mode})


# --- Starting up ---------------------------------------------------------------------


def test_first_start_with_nothing_saved_opens_in_sample():
    assert make_client().get("/api/mode").json() == {"mode": "sample"}


def test_mode_follows_the_database_the_routes_use():
    client = make_client()
    client.app.state.db_kind = DbKind.PERSONAL
    assert client.get("/api/mode").json() == {"mode": "personal"}


def test_restart_opens_in_the_last_mode():
    switch(make_client(), "personal")
    assert make_client().get("/api/mode").json() == {"mode": "personal"}


def test_restart_after_switching_back_to_sample_opens_in_sample():
    client = make_client()
    switch(client, "personal")
    switch(client, "sample")
    assert make_client().get("/api/mode").json() == {"mode": "sample"}


@pytest.mark.parametrize("contents", ["", "PERSONAL!", "real", "\x00\x01"])
def test_unreadable_saved_mode_opens_in_sample(contents):
    path = saved_mode_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(contents)
    assert load_saved_mode() == DbKind.SAMPLE


def test_saved_mode_file_is_private_to_this_account():
    save_mode(DbKind.PERSONAL)
    assert stat.S_IMODE(os.stat(saved_mode_path()).st_mode) == 0o600
    assert saved_mode_path().read_text().strip() == "personal"


# --- Switching ----------------------------------------------------------------------


def test_personal_to_sample_needs_no_touch_id():
    owner = FakeOwner()
    client = make_client(owner)
    client.app.state.db_kind = DbKind.PERSONAL
    response = switch(client, "sample")
    assert response.status_code == 200
    assert response.json() == {"mode": "sample"}
    assert owner.asked == 0


def test_sample_to_personal_asks_for_touch_id_and_switches_when_confirmed():
    owner = FakeOwner(OwnerCheck.CONFIRMED)
    client = make_client(owner)
    response = switch(client, "personal")
    assert response.status_code == 200
    assert response.json() == {"mode": "personal"}
    assert owner.asked == 1
    assert client.get("/api/mode").json() == {"mode": "personal"}


def test_declined_touch_id_stays_in_sample_and_saves_nothing():
    client = make_client(FakeOwner(OwnerCheck.DECLINED))
    response = switch(client, "personal")
    assert response.status_code == 403
    assert "Still in Sample" in response.json()["detail"]
    assert client.get("/api/mode").json() == {"mode": "sample"}
    assert not saved_mode_path().exists()


def test_unavailable_touch_id_stays_in_sample():
    client = make_client(FakeOwner(OwnerCheck.UNAVAILABLE))
    response = switch(client, "personal")
    assert response.status_code == 503
    assert "build_touch_id_helper" in response.json()["detail"]
    assert client.get("/api/mode").json() == {"mode": "sample"}


def test_unexpected_answer_from_the_check_stays_in_sample():
    client = make_client(FakeOwner("yes"))  # anything but CONFIRMED is a no
    assert switch(client, "personal").status_code == 403
    assert client.get("/api/mode").json() == {"mode": "sample"}


def test_switching_to_the_mode_already_in_use_asks_nothing():
    owner = FakeOwner()
    client = make_client(owner)
    client.app.state.db_kind = DbKind.PERSONAL
    assert switch(client, "personal").json() == {"mode": "personal"}
    assert owner.asked == 0


def test_second_switch_while_touch_id_is_waiting_is_refused():
    waiting, release = threading.Event(), threading.Event()

    def slow_owner() -> OwnerCheck:
        waiting.set()
        release.wait(5)
        return OwnerCheck.CONFIRMED

    client = make_client(slow_owner)
    first: list = []
    t = threading.Thread(target=lambda: first.append(switch(client, "personal")))
    t.start()
    assert waiting.wait(5)
    second = switch(client, "personal")
    release.set()
    t.join(5)
    assert second.status_code == 409
    assert first[0].status_code == 200


def test_failed_save_leaves_the_mode_unchanged(monkeypatch):
    client = make_client()

    def broken_save(_kind):
        raise OSError("disk full")

    monkeypatch.setattr("aicity.mode.save_mode", broken_save)
    with pytest.raises(OSError):
        switch(client, "personal")
    assert client.app.state.db_kind == DbKind.SAMPLE


@pytest.mark.parametrize(
    "body",
    [{"mode": "Personal"}, {"mode": "both"}, {"mode": 1}, {}, {"mode": "sample", "extra": 1}],
)
def test_bad_requests_are_refused_and_change_nothing(body):
    owner = FakeOwner()
    client = make_client(owner)
    assert client.put("/api/mode", json=body).status_code == 422
    assert owner.asked == 0
    assert client.get("/api/mode").json() == {"mode": "sample"}


def test_switch_from_another_website_is_refused_before_touch_id():
    owner = FakeOwner()
    app = create_app(dev=False, ask=owner)
    client = TestClient(app, base_url=APP_URL, headers={"origin": "https://evil.example"})
    assert switch(client, "personal").status_code == 403
    assert owner.asked == 0
    assert app.state.db_kind == DbKind.SAMPLE


def test_other_methods_cannot_change_the_mode():
    client = make_client()
    for method in ("POST", "PATCH", "DELETE"):
        assert client.request(method, "/api/mode").status_code == 405, method
    assert client.get("/api/mode").json() == {"mode": "sample"}


# --- The real helper, without showing a prompt ------------------------------------------


def test_missing_helper_means_unavailable(tmp_path):
    assert ask_owner(helper=tmp_path / "nope") == OwnerCheck.UNAVAILABLE


@pytest.mark.parametrize(
    ("exit_code", "expected"),
    [
        (0, OwnerCheck.CONFIRMED),
        (1, OwnerCheck.DECLINED),
        (2, OwnerCheck.UNAVAILABLE),
        (7, OwnerCheck.DECLINED),
    ],
)
def test_helper_exit_codes_are_read_correctly(tmp_path, exit_code, expected):
    helper = tmp_path / "fake-helper"
    helper.write_text(f"#!/bin/sh\nexit {exit_code}\n")
    helper.chmod(0o700)
    assert ask_owner(helper=helper) == expected


def test_helper_that_never_answers_counts_as_declined(tmp_path):
    helper = tmp_path / "slow-helper"
    helper.write_text("#!/bin/sh\nsleep 5\n")
    helper.chmod(0o700)
    assert ask_owner(helper=helper, timeout=0.2) == OwnerCheck.DECLINED


def test_switching_to_sample_clears_mac_notifications(monkeypatch):
    # Titles posted while in Personal mode must not stay on screen during a demo.
    from aicity import mac_notify

    cleared = []
    monkeypatch.setattr(mac_notify, "clear", lambda: cleared.append(True))
    client = make_client(FakeOwner())
    client.app.state.db_kind = DbKind.PERSONAL
    switch(client, "sample")
    assert cleared == [True]
