"""Tests for the data-folder setup script. Temp folders only."""

import importlib.util
import os
import stat
import subprocess
import sys
from pathlib import Path

import pytest

from aicity import config

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "init_data_dir.py"
_spec = importlib.util.spec_from_file_location("init_data_dir", SCRIPT)
init = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(init)


def mode(p: Path) -> int:
    return stat.S_IMODE(p.stat().st_mode)


def test_fresh_setup_creates_private_folders_and_settings(tmp_path):
    data = tmp_path / "data"
    report = init.init_data_dir(data)
    assert mode(data) == 0o700
    for name in init.SUBFOLDERS:
        assert mode(data / name) == 0o700, name
    settings = data / "settings" / "settings.toml"
    assert settings.read_text() == init.EXAMPLE.read_text()
    assert mode(settings) == 0o600
    assert "Settings file loads correctly." in report


def test_existing_settings_are_never_overwritten(tmp_path):
    data = tmp_path / "data"
    init.init_data_dir(data)
    settings = data / "settings" / "settings.toml"
    mine = settings.read_text().replace("Example Town", "My Town")
    settings.write_text(mine)

    report = init.init_data_dir(data)
    assert settings.read_text() == mine
    assert "Settings file already exists, left untouched." in report


def test_running_twice_is_harmless(tmp_path):
    data = tmp_path / "data"
    init.init_data_dir(data)
    (data / "db" / "keep.txt").write_text("existing data")
    report = init.init_data_dir(data)
    assert (data / "db" / "keep.txt").read_text() == "existing data"
    assert not any(line.startswith("Created ") for line in report[1:])


def test_loose_permissions_are_tightened(tmp_path):
    data = tmp_path / "data"
    data.mkdir()
    os.chmod(data, 0o755)
    init.init_data_dir(data)
    assert mode(data) == 0o700


def test_refuses_a_data_folder_inside_the_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    with pytest.raises(init.SetupError, match="inside the code repo"):
        init.init_data_dir(repo / "data", repo_root=repo)
    assert not (repo / "data").exists()


def test_reports_blocked_words_list_without_reading_it(tmp_path):
    data = tmp_path / "data"
    assert any("MISSING" in line for line in init.init_data_dir(data))
    (data / "blocked_words.txt").write_text("zorblax\n")
    report = init.init_data_dir(data)
    assert "Blocked-words list: present." in report
    assert "zorblax" not in "\n".join(report)


def test_broken_settings_are_reported_not_hidden(tmp_path):
    data = tmp_path / "data"
    init.init_data_dir(data)
    (data / "settings" / "settings.toml").write_text("[goals\n")
    report = init.init_data_dir(data)
    assert any("Settings file has a problem" in line for line in report)


def test_script_runs_end_to_end(tmp_path):
    env = {**os.environ, config.DATA_DIR_ENV: str(tmp_path / "data")}
    result = subprocess.run(
        [sys.executable, str(SCRIPT)], env=env, capture_output=True, text=True, check=False
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "Copied the example settings" in result.stdout
    assert (tmp_path / "data" / "settings" / "settings.toml").exists()
