"""Personal and Sample modes: which database the app shows, and switching between them.

Rules (SPEC section 7):
  - The app remembers the last mode and opens in it after a restart.
    The choice is saved in <data folder>/db/last_mode.txt.
  - A missing or unreadable saved mode opens in Sample: the safe side.
  - Personal -> Sample switches at once.
  - Sample -> Personal needs the Mac owner: Touch ID through the Mac's own
    prompt, with the Mac password as the backup. Anything other than a clear
    "confirmed" (cancelled, failed, timed out, helper missing) stays in Sample.

The Touch ID prompt comes from a tiny Swift program (helpers/confirm_owner.swift),
compiled once into build/confirm-owner by scripts/build_touch_id_helper.py.
The prompt belongs to macOS, so a web page can't fake or skip it.
"""

import os
import subprocess
import tempfile
import threading
from collections.abc import Callable
from enum import StrEnum
from pathlib import Path

from aicity import config
from aicity.db import DbKind

REPO_ROOT = Path(__file__).resolve().parents[2]
HELPER_PATH = REPO_ROOT / "build" / "confirm-owner"
# How long the Touch ID prompt may stay open before the switch gives up.
OWNER_CHECK_TIMEOUT_S = 60

# Exit codes the helper uses.
_HELPER_CONFIRMED = 0
_HELPER_UNAVAILABLE = 2


class OwnerCheck(StrEnum):
    CONFIRMED = "confirmed"
    DECLINED = "declined"  # cancelled, wrong finger or password, or timed out
    UNAVAILABLE = "unavailable"  # helper missing or Touch ID / password can't be used


class SwitchRefused(Exception):
    """The owner check didn't confirm. Still in Sample mode."""


class SwitchUnavailable(Exception):
    """The owner check couldn't run at all. Still in Sample mode."""


class SwitchBusy(Exception):
    """A switch is already waiting for Touch ID."""


# --- Remembering the last mode ------------------------------------------------------


def saved_mode_path() -> Path:
    return config.data_dir() / "db" / "last_mode.txt"


def load_saved_mode() -> DbKind:
    """The mode saved last time, or Sample if there is none or it can't be read."""
    try:
        text = saved_mode_path().read_text(encoding="utf-8").strip()
        return DbKind(text)
    except (OSError, ValueError):
        return DbKind.SAMPLE


def save_mode(kind: DbKind) -> None:
    """Save the mode so the next start opens in it.

    Written to a temporary file first and then moved into place, so a crash
    mid-write leaves the old choice, never a half-written file.
    """
    path = saved_mode_path()
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(dir=path.parent, prefix=".last_mode-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:  # mkstemp: owner-only (0600)
            f.write(DbKind(kind).value + "\n")
        os.replace(temp_name, path)
    except BaseException:
        Path(temp_name).unlink(missing_ok=True)
        raise


# --- Asking for Touch ID --------------------------------------------------------------


def ask_owner(helper: Path = HELPER_PATH, timeout: float = OWNER_CHECK_TIMEOUT_S) -> OwnerCheck:
    """Show the Mac's Touch ID prompt (password as the backup) and wait for the answer."""
    if not helper.is_file():
        return OwnerCheck.UNAVAILABLE
    try:
        result = subprocess.run([str(helper)], timeout=timeout, capture_output=True, check=False)
    except subprocess.TimeoutExpired:
        return OwnerCheck.DECLINED  # the prompt is closed when the helper is stopped
    except OSError:
        return OwnerCheck.UNAVAILABLE
    if result.returncode == _HELPER_CONFIRMED:
        return OwnerCheck.CONFIRMED
    if result.returncode == _HELPER_UNAVAILABLE:
        return OwnerCheck.UNAVAILABLE
    return OwnerCheck.DECLINED


# --- Switching ------------------------------------------------------------------------


class ModeSwitcher:
    """Changes app.state.db_kind, asking for Touch ID when the switch shows real data.

    One switch at a time: a second request while Touch ID is waiting is refused
    (SwitchBusy) instead of opening a second prompt.
    """

    def __init__(self, state, ask: Callable[[], OwnerCheck] = ask_owner) -> None:
        self._state = state
        self._ask = ask
        self._lock = threading.Lock()

    def switch(self, target: DbKind) -> DbKind:
        target = DbKind(target)
        if not self._lock.acquire(blocking=False):
            raise SwitchBusy("Already waiting for Touch ID.")
        try:
            if target == self._state.db_kind:
                return target
            if target == DbKind.PERSONAL:
                answer = self._ask()
                if answer == OwnerCheck.UNAVAILABLE:
                    raise SwitchUnavailable(
                        "Touch ID isn't available. Run scripts/build_touch_id_helper.py "
                        "once, then try again. Still in Sample mode."
                    )
                if answer != OwnerCheck.CONFIRMED:
                    raise SwitchRefused("Touch ID didn't confirm. Still in Sample mode.")
            # Save first: if saving fails, the mode doesn't change, so what's on
            # screen and what opens after a restart never disagree.
            save_mode(target)
            self._state.db_kind = target
            return target
        finally:
            self._lock.release()
