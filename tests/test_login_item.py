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
    login_item.install(plist, "<plist/>", run=run, uid=501, pause=0)
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
    assert run.calls == [
        ["git", "-C", str(tmp_path), "status", "--porcelain", "--untracked-files=no"]
    ]
    assert login_item.copy_has_changes(tmp_path, run=FakeRun(out="")) is False


def test_a_symlinked_node_modules_is_not_an_edit(tmp_path):
    """Real git: update links frontend/node_modules into the copy; that alone must not block the next update."""
    import subprocess

    repo = tmp_path / "copy"
    (repo / "frontend").mkdir(parents=True)
    (repo / ".gitignore").write_text("node_modules/\n")
    (repo / "frontend" / "app.ts").write_text("x\n")
    git = ["git", "-C", str(repo), "-c", "user.email=t@example.com", "-c", "user.name=t"]
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    subprocess.run([*git, "add", "."], check=True)
    subprocess.run([*git, "commit", "-qm", "init"], check=True)
    (tmp_path / "real_modules").mkdir()
    (repo / "frontend" / "node_modules").symlink_to(tmp_path / "real_modules")

    assert login_item.copy_has_changes(repo) is False
    (repo / "frontend" / "app.ts").write_text("edited by hand\n")
    assert login_item.copy_has_changes(repo) is True


def test_plist_throttles_restarts(tmp_path):
    assert plist_of(tmp_path)["ThrottleInterval"] == 60


def test_install_retries_while_the_old_app_is_still_exiting(tmp_path):
    class Flaky(FakeRun):
        def __init__(self):
            super().__init__()
            self.bootstraps = 0

        def __call__(self, args, **kwargs):
            self.calls.append(list(args))
            if args[1] == "bootstrap":
                self.bootstraps += 1
                code = 5 if self.bootstraps == 1 else 0  # "Input/output error" the first time
                return SimpleNamespace(returncode=code, stdout="", stderr="")
            return SimpleNamespace(returncode=0, stdout="", stderr="")

    run = Flaky()
    message = login_item.install(tmp_path / "x.plist", "<plist/>", run=run, uid=501, pause=0)
    assert run.bootstraps == 2
    assert "Installed" in message
