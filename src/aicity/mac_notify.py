"""Posting a Mac notification through the small notifier app built on this Mac.

The app (build/Asteroid Belt Notifier.app, made by scripts/build_notifier.py)
shows notifications as "Asteroid Belt" with its own icon; clicking one opens the
app. It's started with `open` as a list of arguments (never through a shell), so
nothing in a task title can run as a command.

If the notifier hasn't been built, or posting fails, this logs one line (the
error type only, never the text) and returns False: the reminder still shows in
the ticker, and the reminder check carries on.
"""

import logging
import subprocess
from collections.abc import Callable
from pathlib import Path

from aicity.mac_messages import MacMessage

log = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[2]
NOTIFIER_APP = REPO_ROOT / "build" / "Asteroid Belt Notifier.app"

_warned_missing = False


def post(
    message: MacMessage,
    app: Path = NOTIFIER_APP,
    run: Callable[..., object] = subprocess.run,
) -> bool:
    global _warned_missing
    if not app.is_dir():
        if not _warned_missing:
            log.warning(
                "Mac notifications are off: the notifier isn't built (scripts/build_notifier.py)."
            )
            _warned_missing = True
        return False
    args = [
        "open",
        "-n",
        "-g",
        str(app),
        "--args",
        "--title",
        message.title,
        "--body",
        message.body,
    ]
    try:
        run(args, check=False, timeout=10, capture_output=True)
    except (OSError, subprocess.SubprocessError) as exc:
        log.warning("Posting a Mac notification failed (%s).", type(exc).__name__)
        return False
    return True
