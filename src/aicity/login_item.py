"""The login item: a launchd agent that starts the app when you log in and
restarts it if it stops (SPEC section 6, "a small background service").

It runs a separate, stable copy of the latest merged code (APP_COPY, a git
worktree), never the folder being developed in, so half-finished work never
runs against real data. scripts/app.py manages it; this module holds the parts
worth testing. Every launchctl and git call goes through `run` with a list of
arguments, so tests can use a fake and nothing ever goes through a shell.
"""

import os
import plistlib
import subprocess
import time
from collections.abc import Callable
from pathlib import Path

LABEL = "local.asteroidbelt.app"
PLIST = Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"
APP_COPY = Path.home() / "Projects" / "ai-city-app"

Run = Callable[..., subprocess.CompletedProcess]


def _run(run: Run, args: list[str]) -> subprocess.CompletedProcess:
    return run(args, check=False, capture_output=True, text=True)


def plist_text(python: Path, app_copy: Path, logs: Path) -> str:
    """The agent's settings: run the stable copy at login, keep it running, log to the data folder."""
    return plistlib.dumps(
        {
            "Label": LABEL,
            "ProgramArguments": [str(python), str(app_copy / "scripts" / "run_app.py")],
            "WorkingDirectory": str(app_copy),
            "RunAtLoad": True,
            "KeepAlive": True,
            # If it can't start (say a dev backend holds port 8765), retry once a minute,
            # not every 10 seconds, so the log doesn't fill with repeats.
            "ThrottleInterval": 60,
            "StandardOutPath": str(logs / "app.log"),
            "StandardErrorPath": str(logs / "app.err.log"),
        }
    ).decode()


def install(
    plist: Path,
    text: str,
    run: Run = subprocess.run,
    uid: int | None = None,
    pause: float = 0.5,
) -> str:
    """Write the agent's settings and (re)load it. Safe to run again."""
    uid = os.getuid() if uid is None else uid
    plist.parent.mkdir(parents=True, exist_ok=True)
    # An old copy may be loaded; unload it first. "Not loaded" is fine.
    _run(run, ["launchctl", "bootout", f"gui/{uid}/{LABEL}"])
    plist.write_text(text)
    # Loading can fail for a moment while the old copy is still shutting down: retry.
    for attempt in range(4):
        result = _run(run, ["launchctl", "bootstrap", f"gui/{uid}", str(plist)])
        if result.returncode == 0:
            break
        time.sleep(pause * (attempt + 1))
    if result.returncode != 0:
        return f"Wrote {plist}, but macOS didn't load it (launchctl said: {result.stderr.strip()})."
    return f"Installed and started the login item ({plist})."


def uninstall(plist: Path, run: Run = subprocess.run, uid: int | None = None) -> str:
    """Stop the agent and delete its settings. Leaves the stable copy and all data alone."""
    uid = os.getuid() if uid is None else uid
    if not plist.exists():
        return "Nothing to remove: the login item isn't installed."
    _run(run, ["launchctl", "bootout", f"gui/{uid}/{LABEL}"])
    plist.unlink()
    return f"Stopped the app and removed the login item ({plist})."


def stop(run: Run = subprocess.run, uid: int | None = None) -> str:
    uid = os.getuid() if uid is None else uid
    result = _run(run, ["launchctl", "bootout", f"gui/{uid}/{LABEL}"])
    return "Stopped the app." if result.returncode == 0 else "The app wasn't running."


def start(plist: Path = PLIST, run: Run = subprocess.run, uid: int | None = None) -> str:
    uid = os.getuid() if uid is None else uid
    if not plist.exists():
        return "The login item isn't installed yet: run  scripts/app.py update  first."
    result = _run(run, ["launchctl", "bootstrap", f"gui/{uid}", str(plist)])
    return "Started the app." if result.returncode == 0 else "The app was already running."


def is_loaded(run: Run = subprocess.run, uid: int | None = None) -> bool:
    uid = os.getuid() if uid is None else uid
    return _run(run, ["launchctl", "print", f"gui/{uid}/{LABEL}"]).returncode == 0


def copy_has_changes(app_copy: Path, run: Run = subprocess.run) -> bool:
    """True if someone edited tracked files in the stable copy (update then refuses to touch it).

    New untracked files don't count: update itself adds a frontend/node_modules link,
    which git lists as untracked.
    """
    args = ["git", "-C", str(app_copy), "status", "--porcelain", "--untracked-files=no"]
    out = _run(run, args).stdout
    return bool(out.strip())
