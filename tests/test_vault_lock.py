"""Tests for the Vault's Touch ID lock: once per app session, enforced by the server.

The real Touch ID prompt is replaced by a fake that answers what it's told.
"""

import threading

import pytest
from fastapi.testclient import TestClient

from aicity import config
from aicity.main import create_app
from aicity.mode import OwnerCheck, SwitchBusy, SwitchRefused, SwitchUnavailable
from aicity.vault_lock import VaultLock

APP_URL = "http://127.0.0.1:8765"


def confirmed() -> OwnerCheck:
    return OwnerCheck.CONFIRMED


def test_confirmed_touch_id_gives_a_working_key():
    lock = VaultLock(confirmed)
    key = lock.unlock()
    assert len(key) >= 40
    assert lock.allows(key)


def test_shut_lock_allows_nothing():
    lock = VaultLock(confirmed)
    assert not lock.allows(None)
    assert not lock.allows("")
    assert not lock.allows("guess")


def test_declined_touch_id_keeps_it_shut():
    lock = VaultLock(lambda: OwnerCheck.DECLINED)
    with pytest.raises(SwitchRefused):
        lock.unlock()
    assert not lock.allows(None)


def test_unavailable_touch_id_is_reported():
    with pytest.raises(SwitchUnavailable):
        VaultLock(lambda: OwnerCheck.UNAVAILABLE).unlock()


def test_only_the_newest_key_works():
    lock = VaultLock(confirmed)
    old, new = lock.unlock(), lock.unlock()
    assert lock.allows(new) and not lock.allows(old)


def test_forget_shuts_it():
    lock = VaultLock(confirmed)
    key = lock.unlock()
    lock.forget()
    assert not lock.allows(key)


def test_a_restart_refuses_the_old_key():
    key = VaultLock(confirmed).unlock()
    assert not VaultLock(confirmed).allows(key)


def test_second_unlock_while_waiting_is_busy():
    started, release = threading.Event(), threading.Event()

    def slow() -> OwnerCheck:
        started.set()
        release.wait(5)
        return OwnerCheck.CONFIRMED

    lock = VaultLock(slow)
    worker = threading.Thread(target=lock.unlock)
    worker.start()
    started.wait(5)
    try:
        with pytest.raises(SwitchBusy):
            lock.unlock()
    finally:
        release.set()
        worker.join(5)


def test_switching_mode_shuts_the_lock(tmp_path, monkeypatch):
    monkeypatch.setenv(config.DATA_DIR_ENV, str(tmp_path))
    app = create_app(dev=False, ask=confirmed)
    client = TestClient(app, base_url=APP_URL, headers={"origin": APP_URL})
    key = app.state.vault_lock.unlock()
    assert client.put("/api/mode", json={"mode": "personal"}).status_code == 200
    assert not app.state.vault_lock.allows(key)
