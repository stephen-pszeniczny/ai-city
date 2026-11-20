"""Opportunity Office settings: [jobs] profiles, sources and platforms."""

import copy
import tomllib
from datetime import time
from decimal import Decimal
from pathlib import Path

import pytest

from aicity.settings import SettingsError, parse_settings

EXAMPLE = Path(__file__).resolve().parent.parent / "settings.example.toml"


@pytest.fixture
def example_data() -> dict:
    return tomllib.loads(EXAMPLE.read_text())


def good_jobs() -> dict:
    return {
        "profiles": [
            {
                "id": "ai_training",
                "name": "AI training",
                "active": True,
                "pay_floor_usd": "30",
                "pay_preferred_usd": "40",
                "hours": [10, 15],
                "job_types": ["contract", "part_time"],
                "title_words": ["AI Trainer", "evaluator"],
                "exclude_words": ["recruiter"],
                "location_ok": ["canada", "worldwide"],
                "skills": ["Python", "technical writing"],
                "gap_words": ["sql"],
            }
        ],
        "sources": [
            {
                "id": "company_a",
                "name": "Company A",
                "kind": "greenhouse",
                "board": "companya",
                "profiles": ["ai_training"],
                "enabled": True,
            }
        ],
        "platforms": [
            {
                "id": "platform_a",
                "name": "Platform A",
                "url": "https://example.com/a",
                "start_stage": "active",
            },
            {"id": "platform_b", "name": "Platform B", "url": "https://example.com/b"},
        ],
    }


def with_jobs(example_data: dict, jobs: dict) -> dict:
    data = copy.deepcopy(example_data)
    data["jobs"] = jobs
    return data


def error_for(data: dict) -> str:
    with pytest.raises(SettingsError) as exc:
        parse_settings(data)
    return str(exc.value)


def test_jobs_is_optional(example_data):
    data = copy.deepcopy(example_data)
    data.pop("jobs", None)
    assert parse_settings(data).jobs is None


def test_jobs_parses_with_defaults(example_data):
    jobs = parse_settings(with_jobs(example_data, good_jobs())).jobs
    assert jobs.scan_day == 6
    assert jobs.scan_time == time(19, 0)
    assert jobs.top_n == 10
    assert jobs.follow_up_days == 10
    assert jobs.roll_off_days == 90
    profile = jobs.profiles[0]
    assert profile.pay_floor_usd == Decimal(30)
    assert profile.pay_preferred_usd == Decimal(40)
    assert profile.hours == (10, 15)
    assert profile.title_words == ("ai trainer", "evaluator")
    assert profile.skills == ("python", "technical writing")
    assert jobs.sources[0].profiles == ("ai_training",)
    assert jobs.platforms[0].start_stage == "active"
    assert jobs.platforms[1].start_stage == "not_joined"


def _edit(path: str, value):
    """A good [jobs] with one value changed; path like 'profiles.0.hours'."""
    jobs = good_jobs()
    keys = path.split(".")
    target = jobs
    for key in keys[:-1]:
        target = target[int(key)] if key.isdigit() else target[key]
    last = keys[-1]
    if value is _DELETE:
        del target[last]
    else:
        target[last] = value
    return jobs


_DELETE = object()


def _dup_profile():
    jobs = good_jobs()
    jobs["profiles"].append(copy.deepcopy(jobs["profiles"][0]))
    return jobs


def _dup_platform():
    jobs = good_jobs()
    jobs["platforms"][1]["id"] = "platform_a"
    return jobs


@pytest.mark.parametrize(
    ("jobs", "fragment", "secret"),
    [
        (_edit("profiles.0.id", "AI Training"), "id must be lowercase", None),
        (_dup_profile(), "different id", None),
        (_dup_platform(), "different id", None),
        (_edit("sources.0.profiles", ["engineering"]), "unknown profile", "engineering"),
        (_edit("sources.0.kind", "workday"), "kind must be one of", "workday"),
        (_edit("platforms.0.start_stage", "hired"), "start_stage must be one of", "hired"),
        (_edit("profiles.0.pay_floor_usd", "50"), "at most pay_preferred_usd", None),
        (_edit("profiles.0.hours", [15, 10]), "hours must be", None),
        (_edit("top_n", 0), "top_n", None),
        (_edit("profiles.0.skills", []), "skills must be", None),
        (_edit("profiles.0.colour", "blue"), "Unknown setting", None),
        (_edit("platforms.0.url", "http://example.com/a"), "https://", None),
        (_edit("profiles", []), "at least one profile", None),
        (_edit("scan_day", "someday"), "scan_day", "someday"),
        (_edit("profiles.0.job_types", ["full_time"]), "job_types", "full_time"),
        (_edit("sources.0.board", "a b/c"), "board", "a b/c"),
    ],
)
def test_jobs_refuses(example_data, jobs, fragment, secret):
    message = error_for(with_jobs(example_data, jobs))
    assert fragment in message
    if secret:
        assert secret not in message


def test_example_file_jobs_block_parses_when_uncommented():
    """The commented example in settings.example.toml is valid once uncommented."""
    text = EXAMPLE.read_text()
    start = text.index("# [jobs]")
    lines = []
    for line in text[start:].splitlines():
        if not line.startswith("#"):
            break
        lines.append(line[2:] if line.startswith("# ") else line[1:])
    block = tomllib.loads("\n".join(lines))
    data = tomllib.loads(text)
    data["jobs"] = block["jobs"]
    jobs = parse_settings(data).jobs
    assert jobs.profiles[0].pay_floor_usd == Decimal(30)
    assert jobs.profiles[0].pay_preferred_usd == Decimal(40)
