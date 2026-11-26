"""Flight School settings: the optional [career] section."""

from pathlib import Path

import pytest

from aicity.career_settings import CareerSettings, parse_career
from aicity.settings import SettingsError, load_settings

EXAMPLE = Path(__file__).resolve().parents[1] / "settings.example.toml"


def test_career_is_optional():
    assert load_settings(EXAMPLE).career is None


def test_defaults():
    assert parse_career({}) == CareerSettings(ai="claude_code", local_model=None, reminder_day=1)


def test_everything_given():
    s = parse_career({"ai": "local", "local_model": "some-model:8b", "reminder_day": 3})
    assert s == CareerSettings(ai="local", local_model="some-model:8b", reminder_day=3)


def test_local_needs_a_model():
    with pytest.raises(SettingsError, match="local_model"):
        parse_career({"ai": "local"})


@pytest.mark.parametrize(
    ("table", "fragment"),
    [
        ({"ai": "cloud"}, "career.ai"),
        ({"reminder_day": 0}, "reminder_day"),
        ({"reminder_day": 29}, "reminder_day"),
        ({"reminder_day": "1"}, "reminder_day"),
        ({"local_model": ""}, "local_model"),
        ({"local_model": "x" * 81}, "local_model"),
        ({"colour": "blue"}, "colour"),
    ],
)
def test_refuses(table, fragment):
    with pytest.raises(SettingsError, match=fragment):
        parse_career(table)


def test_a_career_section_loads(tmp_path):
    f = tmp_path / "settings.toml"
    f.write_text(EXAMPLE.read_text() + "\n[career]\nreminder_day = 2\n")
    assert load_settings(f).career.reminder_day == 2
