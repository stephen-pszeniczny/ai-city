"""Tests for the login item (src/aicity/login_item.py).

Nothing here touches the real Mac: launchctl and git are fake runners, and every
path is temporary.
"""

import plistlib
from pathlib import Path
from types import SimpleNamespace

from aicity import login_item


class FakeRun:
    """Records commands; answers with a return code (and output) per command word."""

    def __init__(self, codes: dict[str, int] | None = None, out: str = "") -> None:
        self.calls: list[list[str]] = []
        self.codes = codes or {}
        self.out = out

    def __call__(self, args, **_kwargs):
        self.calls.append(list(args))
        word = args[1] if args[0] == "launchctl" else args[-1]
        return SimpleNamespace(returncode=self.codes.get(word, 0), stdout=self.out, stderr="")


def plist_of(tmp_path: Path) -> dict:
    text = login_item.plist_text(
        python=Path("/repo/.venv/bin/python"), app_copy=tmp_path / "copy", logs=tmp_path / "logs"
    )
    return plistlib.loads(text.encode())


def test_plist_runs_the_stable_copy_with_logs_and_restarts(tmp_path):
    p = plist_of(tmp_path)
    assert p["Label"] == login_item.LABEL
    assert p["ProgramArguments"] == [
        "/repo/.venv/bin/python",
        str(tmp_path / "copy" / "scripts" / "run_app.py"),
    ]
    assert p["WorkingDirectory"] == str(tmp_path / "copy")
    assert p["RunAtLoad"] is True and p["KeepAlive"] is True
    assert p["StandardOutPath"] == str(tmp_path / "logs" / "app.log")
    assert p["StandardErrorPath"] == str(tmp_path / "logs" / "app.err.log")


def test_plist_never_turns_on_dev_mode(tmp_path):
    p = plist_of(tmp_path)
    assert "AICITY_DEV" not in str(p)


def test_install_writes_the_plist_and_bootstraps(tmp_path):
    run = FakeRun(codes={"bootout": 3})  # nothing loaded yet: bootout fails, which is fine
    plist = tmp_path / "LaunchAgents" / "x.plist"
    login_item.install(plist, "<plist/>", run=run, uid=501)
    assert plist.read_text() == "<plist/>"
    assert run.calls == [
        ["launchctl", "bootout", f"gui/501/{login_item.LABEL}"],
        ["launchctl", "bootstrap", "gui/501", str(plist)],
    ]


def test_install_twice_is_safe(tmp_path):
    run = FakeRun()
    plist = tmp_path / "x.plist"
    login_item.install(plist, "<a/>", run=run, uid=501)
    login_item.install(plist, "<b/>", run=run, uid=501)
    assert plist.read_text() == "<b/>"
    assert [c[1] for c in run.calls] == ["bootout", "bootstrap", "bootout", "bootstrap"]


def test_uninstall_when_nothing_is_installed_says_so(tmp_path):
    run = FakeRun()
    message = login_item.uninstall(tmp_path / "x.plist", run=run, uid=501)
    assert "nothing" in message.lower()
    assert run.calls == []


def test_uninstall_unloads_and_deletes(tmp_path):
    run = FakeRun()
    plist = tmp_path / "x.plist"
    plist.write_text("<plist/>")
    login_item.uninstall(plist, run=run, uid=501)
    assert not plist.exists()
    assert run.calls == [["launchctl", "bootout", f"gui/501/{login_item.LABEL}"]]


def test_update_refuses_a_copy_with_uncommitted_changes(tmp_path):
    run = FakeRun(out=" M src/aicity/main.py\n")
    assert login_item.copy_has_changes(tmp_path, run=run) is True
    assert run.calls == [["git", "-C", str(tmp_path), "status", "--porcelain"]]
    assert login_item.copy_has_changes(tmp_path, run=FakeRun(out="")) is False
