"""Tests for reading and checking the settings file.

Uses the public example file and broken copies of it in temp folders only.
"""

import copy
import tomllib
from datetime import time
from decimal import Decimal
from pathlib import Path

import pytest

from aicity import config
from aicity.settings import (
    BUILDING_IDS,
    SettingsError,
    load_settings,
    parse_settings,
    settings_path,
)

EXAMPLE = Path(__file__).resolve().parent.parent / "settings.example.toml"


@pytest.fixture
def example_data() -> dict:
    return tomllib.loads(EXAMPLE.read_text())


def broken(example_data: dict, section: str, key: str, value) -> dict:
    data = copy.deepcopy(example_data)
    data[section][key] = value
    return data


def error_for(data: dict) -> str:
    with pytest.raises(SettingsError) as exc:
        parse_settings(data)
    return str(exc.value)


# --- The example file ------------------------------------------------------


def test_example_file_loads_and_is_complete():
    s = load_settings(EXAMPLE)
    assert set(s.buildings) == set(BUILDING_IDS)
    assert s.buildings["planner"] == "Mission Control"
    assert s.goals.monthly_income_cents == 400_000
    assert s.goals.currency == "CAD"
    assert s.tasks.reminder_time == time(9, 0)
    assert s.income.tax_set_aside_percent == Decimal(20)
    assert s.income.tax_set_aside_is_placeholder is True


def test_there_are_nine_buildings():
    assert len(BUILDING_IDS) == 9
    assert len(set(BUILDING_IDS)) == 9


# --- Where the file lives --------------------------------------------------


def test_real_file_is_in_the_data_folder(monkeypatch, tmp_path):
    monkeypatch.setenv(config.DATA_DIR_ENV, str(tmp_path))
    assert settings_path() == tmp_path.resolve() / "settings" / "settings.toml"


def test_missing_file_explains_what_to_do(tmp_path):
    with pytest.raises(SettingsError, match="init_data_dir"):
        load_settings(tmp_path / "nope.toml")


def test_invalid_toml_is_reported(tmp_path):
    bad = tmp_path / "settings.toml"
    bad.write_text("[goals\nmonthly_income = ")
    with pytest.raises(SettingsError, match="valid TOML"):
        load_settings(bad)


# --- Sections and keys -----------------------------------------------------


def test_missing_section(example_data):
    del example_data["location"]
    assert "[location]" in error_for(example_data)


def test_unknown_section_catches_typos(example_data):
    example_data["goal"] = {}
    assert "goal" in error_for(example_data)


def test_unknown_key_catches_typos(example_data):
    example_data["tasks"]["stale_after_dayz"] = 3
    assert "stale_after_dayz" in error_for(example_data)


def test_missing_building(example_data):
    del example_data["buildings"]["gym"]
    assert "gym" in error_for(example_data)


def test_extra_building_refused(example_data):
    example_data["buildings"]["casino"] = "Casino"
    assert "casino" in error_for(example_data)


def test_blank_building_name_refused(example_data):
    assert "buildings.gym" in error_for(broken(example_data, "buildings", "gym", "  "))


# --- Values ----------------------------------------------------------------


@pytest.mark.parametrize("value", ["4000", "4000.5", "4000.50", "0"])
def test_good_money_amounts(example_data, value):
    s = parse_settings(broken(example_data, "goals", "monthly_income", value))
    assert s.goals.monthly_income_cents == int(Decimal(value) * 100)


@pytest.mark.parametrize("value", ["4000.555", "-5", "4,000", "$4000", "abc", "", 4000, 4000.5])
def test_bad_money_amounts(example_data, value):
    assert "goals.monthly_income" in error_for(
        broken(example_data, "goals", "monthly_income", value)
    )


def test_money_is_exact_not_rounded(example_data):
    s = parse_settings(broken(example_data, "goals", "monthly_income", "0.29"))
    assert s.goals.monthly_income_cents == 29  # 0.29 * 100 as a float is 28.999...


@pytest.mark.parametrize("value", ["cad", "CA", "CADD", "", 5])
def test_bad_currency(example_data, value):
    assert "goals.currency" in error_for(broken(example_data, "goals", "currency", value))


@pytest.mark.parametrize("value", ["9:00", "24:00", "09:60", "9am", "", 900])
def test_bad_reminder_time(example_data, value):
    assert "reminder_time" in error_for(broken(example_data, "tasks", "reminder_time", value))


@pytest.mark.parametrize("value", [0, 366, -1, 1.5, "14", True])
def test_bad_stale_days(example_data, value):
    assert "stale_after_days" in error_for(broken(example_data, "tasks", "stale_after_days", value))


@pytest.mark.parametrize(
    ("key", "value"), [("latitude", 91), ("longitude", -181), ("latitude", "45")]
)
def test_bad_coordinates(example_data, key, value):
    assert f"location.{key}" in error_for(broken(example_data, "location", key, value))


@pytest.mark.parametrize("value", ["Not/AZone", "", "Mars/Olympus_Mons"])
def test_bad_timezone(example_data, value):
    assert "location.timezone" in error_for(broken(example_data, "location", "timezone", value))


@pytest.mark.parametrize("value", ["101", "-1", "NaN", "Infinity", "abc", 20])
def test_bad_tax_percent(example_data, value):
    msg = error_for(broken(example_data, "income", "tax_set_aside_percent", value))
    assert "tax_set_aside_percent" in msg


def test_placeholder_flag_must_be_true_or_false(example_data):
    msg = error_for(broken(example_data, "income", "tax_set_aside_is_placeholder", "yes"))
    assert "tax_set_aside_is_placeholder" in msg


# --- Privacy ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("section", "key", "secret"),
    [
        ("goals", "monthly_income", "98765.4321"),
        ("location", "timezone", "Secret/Hometown"),
        ("tasks", "reminder_time", "secret-o-clock"),
        ("income", "tax_set_aside_percent", "secret-percent"),
        ("buildings", "gym", 12345),
    ],
)
def test_errors_never_repeat_the_value(example_data, section, key, secret):
    msg = error_for(broken(example_data, section, key, secret))
    assert str(secret) not in msg


# --- Pay schedules ----------------------------------------------------------------

GOOD_SCHEDULE = {
    "name": "Platform A",
    "period": "weekly",
    "week_starts": "saturday",
    "released_days_after_period_end": [5, 6],
    "arrives_days_after_release": [3, 4],
}


def with_schedule(example_data: dict, **changes) -> dict:
    data = copy.deepcopy(example_data)
    data["pay_schedules"] = {"platform_a": GOOD_SCHEDULE | changes}
    return data


def test_pay_schedule_is_read(example_data):
    s = parse_settings(with_schedule(example_data))
    p = s.pay_schedules["platform_a"]
    assert (p.id, p.name, p.week_starts, p.release_after, p.arrive_after) == (
        "platform_a",
        "Platform A",
        5,
        (5, 6),
        (3, 4),
    )


def test_pay_schedules_section_is_optional(example_data):
    data = {k: v for k, v in example_data.items() if k != "pay_schedules"}
    assert parse_settings(data).pay_schedules == {}


@pytest.mark.parametrize(
    "bad",
    [
        {"period": "monthly"},
        {"week_starts": "someday"},
        {"released_days_after_period_end": [6, 5]},
        {"released_days_after_period_end": [5]},
        {"released_days_after_period_end": [5.5, 6]},
        {"released_days_after_period_end": [True, 6]},
        {"arrives_days_after_release": [-1, 2]},
        {"arrives_days_after_release": [3, 61]},
        {"name": ""},
        {"surprise": 1},
    ],
)
def test_bad_pay_schedule_is_refused(example_data, bad):
    assert "pay_schedules.platform_a" in error_for(with_schedule(example_data, **bad))


def test_missing_pay_schedule_key_is_refused(example_data):
    data = with_schedule(example_data)
    del data["pay_schedules"]["platform_a"]["week_starts"]
    assert "pay_schedules.platform_a" in error_for(data)


@pytest.mark.parametrize("bad_id", ["Platform", "1abc", "a-b", "x" * 32])
def test_bad_pay_schedule_id_is_refused(example_data, bad_id):
    data = copy.deepcopy(example_data)
    data["pay_schedules"] = {bad_id: dict(GOOD_SCHEDULE)}
    assert "pay_schedules" in error_for(data)


def test_pay_schedules_must_be_a_section(example_data):
    data = copy.deepcopy(example_data)
    data["pay_schedules"] = "weekly"
    assert "pay_schedules" in error_for(data)
