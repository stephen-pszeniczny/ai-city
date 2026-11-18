"""Run the Asteroid Belt app like an installed Mac app.

    .venv/bin/python scripts/app.py update     after merging a PR: refresh the app's own copy,
                                               build it, (re)install the login item, start it
    .venv/bin/python scripts/app.py stop       pause it (e.g. before dev work on port 8765)
    .venv/bin/python scripts/app.py start      bring it back
    .venv/bin/python scripts/app.py status     is it running, and which version
    .venv/bin/python scripts/app.py uninstall  stop it and remove the login item

The app runs from its own copy of the latest merged code (~/Projects/ai-city-app,
a git worktree of origin/main), never from this folder, so half-finished work
never runs against your real data. It uses this folder's Python environment and
Node packages, so nothing is installed twice. Each command says what it did.
"""

import subprocess
import sys
import time
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "src"))

from aicity import config, login_item

PYTHON = REPO / ".venv" / "bin" / "python"
COPY = login_item.APP_COPY
HEALTH = f"http://{config.HOST}:{config.PORT}/api/health"


def sh(args: list[str], cwd: Path | None = None) -> None:
    print("  $", " ".join(args))
    subprocess.run(args, cwd=cwd, check=True)


def answering() -> bool:
    try:
        with urllib.request.urlopen(HEALTH, timeout=2) as r:
            return r.status == 200
    except OSError:
        return False


def update() -> None:
    print("Fetching the latest merged code…")
    sh(["git", "-C", str(REPO), "fetch", "origin"])
    if not COPY.exists():
        print(f"Making the app's own copy at {COPY}…")
        sh(["git", "-C", str(REPO), "worktree", "add", "--detach", str(COPY), "origin/main"])
    else:
        if login_item.copy_has_changes(COPY):
            sys.exit(
                f"Stopped: files in {COPY} were edited by hand. Nothing was changed. "
                "Move or undo those edits (git -C ~/Projects/ai-city-app status), then run update again."
            )
        sh(["git", "-C", str(COPY), "checkout", "--detach", "origin/main"])
    modules = COPY / "frontend" / "node_modules"
    if not modules.exists():
        modules.symlink_to(REPO / "frontend" / "node_modules")
        print("  linked frontend/node_modules from this folder")

    print("Building the page and the helpers in the app's copy…")
    sh(["npm", "run", "build"], cwd=COPY / "frontend")
    sh([str(PYTHON), str(COPY / "scripts" / "build_touch_id_helper.py")])
    sh([str(PYTHON), str(COPY / "scripts" / "build_notifier.py")])

    logs = config.data_dir() / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    print(login_item.install(login_item.PLIST, login_item.plist_text(PYTHON, COPY, logs)))
    wait_until_answering()
    status()


def wait_until_answering(seconds: float = 20) -> None:
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if answering():
            return
        time.sleep(0.5)
    print(
        "The app hasn't answered yet. If a development backend is using port 8765, stop it "
        f"(Ctrl+C in its window). Logs: {config.data_dir() / 'logs' / 'app.err.log'}"
    )


def status() -> None:
    loaded = login_item.is_loaded()
    print(f"Login item: {'installed and loaded' if loaded else 'not loaded'}")
    print(f"Answering at http://{config.HOST}:{config.PORT}: {'yes' if answering() else 'no'}")
    if COPY.exists():
        commit = subprocess.run(
            ["git", "-C", str(COPY), "log", "-1", "--format=%h %s"],
            capture_output=True,
            text=True,
            check=False,
        ).stdout.strip()
        print(f"Running: {commit}")


def main() -> None:
    commands = {
        "update": update,
        "stop": lambda: print(login_item.stop()),
        "start": lambda: (print(login_item.start()), wait_until_answering(), status()),
        "status": status,
        "uninstall": lambda: print(login_item.uninstall(login_item.PLIST)),
    }
    if len(sys.argv) != 2 or sys.argv[1] not in commands:
        sys.exit(__doc__)
    commands[sys.argv[1]]()


if __name__ == "__main__":
    main()
