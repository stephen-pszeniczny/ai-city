"""Tests for working out where the data folder is.

These only compute paths. A fake home folder is used so the real data
folder is never involved, even in the 'default' case.
"""

from pathlib import Path

from aicity import config


def test_uses_env_var_when_set(monkeypatch, tmp_path):
    monkeypatch.setenv(config.DATA_DIR_ENV, str(tmp_path / "data"))
    assert config.data_dir() == (tmp_path / "data").resolve()


def test_defaults_to_folder_in_home_when_env_var_missing(monkeypatch, tmp_path):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.delenv(config.DATA_DIR_ENV, raising=False)
    assert config.data_dir() == (tmp_path / "AI-City-Data").resolve()


def test_blank_env_var_counts_as_missing(monkeypatch, tmp_path):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv(config.DATA_DIR_ENV, "   ")
    assert config.data_dir() == (tmp_path / "AI-City-Data").resolve()


def test_tilde_is_expanded(monkeypatch, tmp_path):
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv(config.DATA_DIR_ENV, "~/somewhere")
    assert config.data_dir() == (tmp_path / "somewhere").resolve()


def test_result_is_always_absolute(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv(config.DATA_DIR_ENV, "relative/folder")
    result = config.data_dir()
    assert result.is_absolute()
    assert result == (tmp_path / "relative/folder").resolve()


def test_does_not_create_the_folder(monkeypatch, tmp_path):
    target = tmp_path / "not-created"
    monkeypatch.setenv(config.DATA_DIR_ENV, str(target))
    config.data_dir()
    assert not Path(target).exists()


def test_listens_on_this_mac_only():
    assert config.HOST == "127.0.0.1"
