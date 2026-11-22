"""Opportunity Office settings: the optional [jobs] section (platform tracker)."""

from decimal import Decimal

import pytest

from aicity.jobs_settings import DEFAULT_CHECK_DAYS, JobPlatform, parse_jobs
from aicity.settings import SettingsError


def platform(**overrides) -> dict:
    entry = {"id": "platform_a", "name": "Platform A", "url": "https://example.com/login"}
    entry.update(overrides)
    return entry


def jobs(**overrides) -> dict:
    t = {"platforms": [platform()]}
    t.update(overrides)
    return t


def test_jobs_parses_with_defaults():
    s = parse_jobs(jobs())
    assert s.pay_floor_usd == Decimal(30)
    assert s.pay_preferred_usd == Decimal(40)
    assert s.master_resume_label is None
    assert s.check_days == DEFAULT_CHECK_DAYS
    assert DEFAULT_CHECK_DAYS == {
        "active": 3,
        "applied": 7,
        "assessment": 7,
        "onboarding": 7,
        "paused": 30,
    }
    assert s.platforms == (
        JobPlatform("platform_a", "Platform A", "https://example.com/login", "not_applied"),
    )


def test_everything_given():
    s = parse_jobs(
        jobs(
            pay_floor_usd="25",
            pay_preferred_usd="45",
            master_resume_label="v1 Nov 2026",
            platforms=[platform(start_status="active"), platform(id="platform_b", name="B")],
        )
    )
    assert (s.pay_floor_usd, s.pay_preferred_usd) == (Decimal(25), Decimal(45))
    assert s.master_resume_label == "v1 Nov 2026"
    assert [p.start_status for p in s.platforms] == ["active", "not_applied"]


def test_check_days_override_one():
    s = parse_jobs(jobs(check_days={"active": 2}))
    assert s.check_days == {**DEFAULT_CHECK_DAYS, "active": 2}


@pytest.mark.parametrize(
    ("overrides", "fragment"),
    [
        ({"pay_floor_usd": "50", "pay_preferred_usd": "40"}, "pay_floor_usd"),
        ({"platforms": [platform(), platform()]}, "different id"),
        ({"platforms": [platform(url="http://example.com")]}, "https://"),
        ({"platforms": [platform(start_status="quiet")]}, "start_status"),
        ({"platforms": [platform(id="Bad-Id")]}, "id"),
        ({"check_days": {"rejected": 5}}, "check_days"),
        ({"check_days": {"active": 0}}, "check_days"),
        ({"check_days": {"active": 91}}, "check_days"),
        ({"platforms": []}, "at least one platform"),
        ({"master_resume_label": ""}, "master_resume_label"),
        ({"master_resume_label": "x" * 41}, "master_resume_label"),
        ({"surprise": 1}, "surprise"),
    ],
)
def test_jobs_refuses(overrides, fragment):
    with pytest.raises(SettingsError, match=fragment):
        parse_jobs(jobs(**overrides))


def test_values_are_never_echoed():
    with pytest.raises(SettingsError) as err:
        parse_jobs(jobs(platforms=[platform(url="http://secret.example")]))
    assert "secret" not in str(err.value)


def test_old_shape_gets_a_clear_message():
    old = {"profiles": [{}], "sources": [], "scan_day": "sun", "platforms": [platform()]}
    with pytest.raises(SettingsError, match="no longer used"):
        parse_jobs(old)


def test_jobs_is_optional(tmp_path, monkeypatch):
    from pathlib import Path

    from aicity.settings import load_settings

    example = Path(__file__).resolve().parents[1] / "settings.example.toml"
    assert load_settings(example).jobs is None
