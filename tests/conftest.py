"""Test setup that runs before any test: keeps tests away from real data.

1. If AICITY_DATA_DIR isn't set, point it at a fresh throwaway folder.
2. Always run the guard: if the data folder is the real private data folder
   (or anywhere inside it), stop the whole test run before any test starts.

The real folder is checked two ways: from $HOME, and from the Mac account's
actual home folder. So even a test run with a changed $HOME can't reach it.
"""

import os
import pwd
import shutil
import tempfile
from pathlib import Path

import pytest

from aicity import config as app_config

GUARD_EXIT_CODE = 3
_temp_dir: str | None = None


def protected_dirs() -> list[Path]:
    """Every location the real private data folder could be."""
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


def pytest_configure(config: pytest.Config) -> None:
    global _temp_dir
    if not os.environ.get(app_config.DATA_DIR_ENV, "").strip():
        _temp_dir = tempfile.mkdtemp(prefix="aicity-test-data-")
        os.environ[app_config.DATA_DIR_ENV] = _temp_dir

    if is_protected(app_config.data_dir(), protected_dirs()):
        pytest.exit(
            "SAFETY GUARD: tests are pointed at the real private data folder. "
            "Refusing to run. Unset AICITY_DATA_DIR or point it at a temp folder.",
            returncode=GUARD_EXIT_CODE,
        )


def pytest_unconfigure(config: pytest.Config) -> None:
    if _temp_dir:
        shutil.rmtree(_temp_dir, ignore_errors=True)
