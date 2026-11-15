"""The test safety guard's logic: where the real private data folder could be.

Used by conftest.py (which runs the guard before any test) and by
test_guard.py (which proves it works). Kept in its own module so both can
import it normally.
"""

import os
import pwd
from pathlib import Path

from aicity import config as app_config

GUARD_EXIT_CODE = 3


def protected_dirs() -> list[Path]:
    """Every location the real private data folder could be: from $HOME and the account's home."""
    account_home = Path(pwd.getpwuid(os.getuid()).pw_dir)
    candidates = {
        app_config.default_data_dir().resolve(),
        (account_home / app_config.DEFAULT_DATA_DIR_NAME).resolve(),
    }
    return sorted(candidates)


def is_protected(data_dir: Path, protected: list[Path]) -> bool:
    """True if data_dir is a protected folder or anywhere inside one."""
    data_dir = data_dir.resolve()
    return any(data_dir.is_relative_to(p.resolve()) for p in protected)
