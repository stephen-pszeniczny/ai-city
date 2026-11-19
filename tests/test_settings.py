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
    BlockRule,
    PlanSettings,
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


def test_statement_due_day_is_optional_and_defaults_to_8(example_data):
    example_data["income"].pop("statement_due_day", None)
    assert parse_settings(example_data).income.statement_due_day == 8


def test_statement_due_day_is_read(example_data):
    example_data["income"]["statement_due_day"] = 10
    assert parse_settings(example_data).income.statement_due_day == 10


@pytest.mark.parametrize("value", [0, 29, "8", 8.5, True])
def test_statement_due_day_out_of_range_is_refused(example_data, value):
    example_data["income"]["statement_due_day"] = value
    msg = error_for(example_data)
    assert "income.statement_due_day must be a whole number from 1 to 28" in msg


@pytest.mark.parametrize("key", ["main_job_monthly", "side_income_monthly"])
def test_old_goal_split_keys_are_refused(example_data, key):
    assert key in error_for(broken(example_data, "goals", key, "1000.00"))


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


def name_only(example_data: dict, **block) -> dict:
    data = copy.deepcopy(example_data)
    data["pay_schedules"] = {"platform_b": {"name": "Platform B"} | block}
    return data


def test_name_only_schedule_is_untimed(example_data):
    p = parse_settings(name_only(example_data)).pay_schedules["platform_b"]
    assert (p.name, p.timed, p.week_starts, p.release_after, p.arrive_after) == (
        "Platform B",
        False,
        None,
        None,
        None,
    )


def test_timed_schedule_says_so(example_data):
    assert parse_settings(with_schedule(example_data)).pay_schedules["platform_a"].timed is True


def test_name_only_schedule_keeps_deposit_match(example_data):
    p = parse_settings(name_only(example_data, deposit_match="ACME TASKS")).pay_schedules
    assert p["platform_b"].deposit_match == "ACME TASKS"


def test_partial_timing_is_refused(example_data):
    msg = error_for(name_only(example_data, week_starts="saturday"))
    assert "pay_schedules.platform_b" in msg
    for key in ("period", "released_days_after_period_end", "arrives_days_after_release"):
        assert key in msg


@pytest.mark.parametrize("bad_id", ["Platform", "1abc", "a-b", "x" * 32])
def test_bad_pay_schedule_id_is_refused(example_data, bad_id):
    data = copy.deepcopy(example_data)
    data["pay_schedules"] = {bad_id: dict(GOOD_SCHEDULE)}
    assert "pay_schedules" in error_for(data)


def test_pay_schedules_must_be_a_section(example_data):
    data = copy.deepcopy(example_data)
    data["pay_schedules"] = "weekly"
    assert "pay_schedules" in error_for(data)


# --- Deposit matching words --------------------------------------------------------


def test_main_job_is_read(example_data):
    data = copy.deepcopy(example_data)
    data["main_job"] = {"name": "Day job", "deposit_match": " DAY JOB PAY "}
    mj = parse_settings(data).main_job
    assert (mj.name, mj.deposit_match) == ("Day job", "DAY JOB PAY")


def test_main_job_is_optional(example_data):
    data = {k: v for k, v in example_data.items() if k != "main_job"}
    assert parse_settings(data).main_job is None


@pytest.mark.parametrize(
    "block",
    [
        {"name": "Day job", "deposit_match": "  "},
        {"name": "Day job"},
        {"name": "Day job", "deposit_match": "X", "surprise": 1},
    ],
)
def test_bad_main_job_is_refused(example_data, block):
    data = copy.deepcopy(example_data)
    data["main_job"] = block
    assert "main_job" in error_for(data)


def test_schedule_deposit_match_is_read_and_optional(example_data):
    assert (
        parse_settings(with_schedule(example_data)).pay_schedules["platform_a"].deposit_match
        is None
    )
    s = parse_settings(with_schedule(example_data, deposit_match="NIMBUS LABS"))
    assert s.pay_schedules["platform_a"].deposit_match == "NIMBUS LABS"


def test_blank_schedule_deposit_match_is_refused(example_data):
    assert "pay_schedules.platform_a" in error_for(with_schedule(example_data, deposit_match=" "))


# --- [plan]: fixed blocks for the Daily plan ---------------------------------------

WORK_BLOCK = {
    "title": "Work",
    "kind": "work",
    "days": ["mon", "wed"],
    "start": "09:00",
    "end": "12:00",
}


def with_plan(example_data: dict, plan) -> dict:
    data = copy.deepcopy(example_data)
    data["plan"] = plan
    return data


def test_plan_is_optional(example_data):
    assert parse_settings(example_data).plan is None


def test_plan_blocks_parse(example_data):
    s = parse_settings(with_plan(example_data, {"blocks": [WORK_BLOCK]}))
    assert s.plan == PlanSettings(blocks=(BlockRule("Work", "work", (0, 2), time(9), time(12)),))


def test_plan_with_no_blocks_is_fine(example_data):
    assert parse_settings(with_plan(example_data, {"blocks": []})).plan == PlanSettings(blocks=())


def test_plan_days_are_sorted(example_data):
    block = {**WORK_BLOCK, "days": ["fri", "mon"]}
    s = parse_settings(with_plan(example_data, {"blocks": [block]}))
    assert s.plan.blocks[0].days == (0, 4)


@pytest.mark.parametrize(
    ("plan", "fragment", "secret"),
    [
        ({"blocks": [WORK_BLOCK], "extra": 1}, "plan", None),
        ({"blocks": [{**WORK_BLOCK, "colour": "red"}]}, "plan.blocks", None),
        ({"blocks": [{**WORK_BLOCK, "kind": "nap"}]}, "kind", "nap"),
        ({"blocks": [{**WORK_BLOCK, "days": ["monday"]}]}, "days", "monday"),
        ({"blocks": [{**WORK_BLOCK, "days": []}]}, "days", None),
        ({"blocks": [{**WORK_BLOCK, "days": ["mon", "mon"]}]}, "days", None),
        ({"blocks": [{**WORK_BLOCK, "days": "mon"}]}, "days", None),
        ({"blocks": [{**WORK_BLOCK, "start": "7:45"}]}, "start", "7:45"),
        ({"blocks": [{**WORK_BLOCK, "end": "09:00"}]}, "end", None),
        ({"blocks": [{**WORK_BLOCK, "end": "08:00"}]}, "end", "08:00"),
        ({"blocks": [{**WORK_BLOCK, "end": "24:00"}]}, "end", "24:00"),
        ({"blocks": [{**WORK_BLOCK, "title": "   "}]}, "title", None),
        ({"blocks": [{**WORK_BLOCK, "title": "x" * 101}]}, "title", None),
        ({"blocks": [{k: v for k, v in WORK_BLOCK.items() if k != "end"}]}, "end", None),
        ({"blocks": {"title": "Work"}}, "plan.blocks", None),
        ({"blocks": ["Work"]}, "plan.blocks", None),
        ({}, "blocks", None),
        ("Work", "plan", None),
    ],
)
def test_plan_refuses(example_data, plan, fragment, secret):
    message = error_for(with_plan(example_data, plan))
    assert fragment in message
    if secret:
        assert secret not in message
