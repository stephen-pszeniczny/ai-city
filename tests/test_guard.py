"""Proof that the test safety guard (tests/conftest.py) actually works.

Every 'real' folder here is fake: a pretend home folder inside a temp folder.
The real private data folder is never used.
"""

import os
import subprocess
import sys
from pathlib import Path

from aicity import config
from conftest import GUARD_EXIT_CODE, is_protected

REPO_ROOT = Path(__file__).resolve().parent.parent


# --- The check itself ------------------------------------------------------


def test_exact_folder_is_protected(tmp_path):
    real = tmp_path / "AI-City-Data"
    assert is_protected(real, [real])


def test_folder_inside_is_protected(tmp_path):
    real = tmp_path / "AI-City-Data"
    assert is_protected(real / "db" / "deeper", [real])


def test_similar_name_next_to_it_is_not_protected(tmp_path):
    # A plain text comparison would wrongly match "AI-City-Data-old".
    real = tmp_path / "AI-City-Data"
    assert not is_protected(tmp_path / "AI-City-Data-old", [real])


def test_parent_folder_is_not_protected(tmp_path):
    real = tmp_path / "AI-City-Data"
    assert not is_protected(tmp_path, [real])


def test_shortcut_pointing_inside_is_protected(tmp_path):
    real = tmp_path / "AI-City-Data"
    (real / "db").mkdir(parents=True)
    shortcut = tmp_path / "innocent-looking-link"
    shortcut.symlink_to(real / "db")
    assert is_protected(shortcut, [real])


def test_sneaky_dot_dot_path_is_protected(tmp_path):
    real = tmp_path / "AI-City-Data"
    (tmp_path / "other").mkdir()
    sneaky = tmp_path / "other" / ".." / "AI-City-Data"
    assert is_protected(sneaky, [real])


# --- This test run ---------------------------------------------------------


def test_this_run_uses_a_safe_folder():
    from conftest import protected_dirs

    assert os.environ.get(config.DATA_DIR_ENV)
    assert not is_protected(config.data_dir(), protected_dirs())


# --- A whole separate test run, deliberately pointed at a fake real folder --


def _run_pytest(home: Path, data_dir: str | None) -> subprocess.CompletedProcess:
    env = {k: v for k, v in os.environ.items() if k != config.DATA_DIR_ENV}
    env["HOME"] = str(home)
    if data_dir is not None:
        env[config.DATA_DIR_ENV] = data_dir
    return subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests/test_health.py"],
        check=False,  # the run is expected to fail in most of these tests
        cwd=REPO_ROOT,
        env=env,
        capture_output=True,
        text=True,
        timeout=60,
    )


def test_guard_stops_run_pointed_at_real_folder(tmp_path):
    fake_home = tmp_path / "home"
    fake_real = fake_home / "AI-City-Data"
    fake_real.mkdir(parents=True)

    result = _run_pytest(fake_home, str(fake_real))

    assert result.returncode == GUARD_EXIT_CODE
    assert "SAFETY GUARD" in result.stdout + result.stderr
    assert "passed" not in result.stdout  # no test got to run


def test_guard_stops_run_pointed_inside_real_folder(tmp_path):
    fake_home = tmp_path / "home"
    inside = fake_home / "AI-City-Data" / "db"
    inside.mkdir(parents=True)

    result = _run_pytest(fake_home, str(inside))

    assert result.returncode == GUARD_EXIT_CODE
    assert "passed" not in result.stdout


def test_run_without_setting_uses_temp_folder_and_passes(tmp_path):
    # Control check: the guard doesn't block a normal, safe run.
    fake_home = tmp_path / "home"
    fake_home.mkdir()

    result = _run_pytest(fake_home, None)

    assert result.returncode == 0, result.stdout + result.stderr
    assert not (fake_home / "AI-City-Data").exists()
