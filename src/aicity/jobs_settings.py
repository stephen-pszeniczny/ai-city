"""Opportunity Office settings: the optional [jobs] section (a platform tracker).

The roster's platforms, the pay floor logged projects are compared against, the
master resume's version label (Flight School will own it later) and how often a
platform is due for a check, by its status. Real values live in the private
settings file; settings.example.toml has made-up ones.
"""

import re
from dataclasses import dataclass
from decimal import Decimal

from aicity.settings import SettingsError, _decimal, _only_keys, _text

STATUSES = ("not_applied", "applied", "assessment", "onboarding", "active", "paused", "rejected")
# Days between checks, by status. Not applied and rejected are never checked.
DEFAULT_CHECK_DAYS = {"active": 3, "applied": 7, "assessment": 7, "onboarding": 7, "paused": 30}

_OLD_KEYS = {
    "profiles",
    "sources",
    "scan_day",
    "scan_time",
    "top_n",
    "follow_up_days",
    "roll_off_days",
}
_ID = re.compile(r"[a-z][a-z0-9_]{0,30}")
_NAME_MAX = 60
_URL_MAX = 500
_LABEL_MAX = 40
_PLATFORMS_MAX = 30


@dataclass(frozen=True)
class JobPlatform:
    id: str
    name: str
    url: str
    start_status: str


@dataclass(frozen=True)
class JobsSettings:
    pay_floor_usd: Decimal
    pay_preferred_usd: Decimal
    master_resume_label: str | None
    check_days: dict[str, int]
    platforms: tuple[JobPlatform, ...]


def parse_jobs(t) -> JobsSettings:
    """Check the [jobs] table and turn it into JobsSettings."""
    if not isinstance(t, dict):
        raise SettingsError("[jobs] must be a table.")
    if _OLD_KEYS & set(t):
        raise SettingsError(
            "jobs: profiles, sources and scan settings are no longer used "
            "(2026-11-22 redesign); remove them."
        )
    where = "[jobs]"
    _only_keys(
        t,
        where,
        {"pay_floor_usd", "pay_preferred_usd", "master_resume_label", "check_days", "platforms"},
    )
    floor = _decimal(t, "jobs", "pay_floor_usd") if "pay_floor_usd" in t else Decimal(30)
    preferred = (
        _decimal(t, "jobs", "pay_preferred_usd") if "pay_preferred_usd" in t else Decimal(40)
    )
    if floor < 0 or preferred < 0:
        raise SettingsError("jobs: pay amounts can't be negative.")
    if floor > preferred:
        raise SettingsError("jobs.pay_floor_usd must be at most pay_preferred_usd.")
    platforms = _platforms(t.get("platforms", []))
    return JobsSettings(
        pay_floor_usd=floor,
        pay_preferred_usd=preferred,
        master_resume_label=_label(t),
        check_days=_check_days(t.get("check_days", {})),
        platforms=platforms,
    )


def _label(t: dict) -> str | None:
    if "master_resume_label" not in t:
        return None
    value = t["master_resume_label"]
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= _LABEL_MAX:
        raise SettingsError(
            f"jobs.master_resume_label must be text of 1 to {_LABEL_MAX} characters."
        )
    return value.strip()


def _check_days(t) -> dict[str, int]:
    message = (
        "jobs.check_days may set "
        f"{', '.join(DEFAULT_CHECK_DAYS)} to a whole number of days from 1 to 90."
    )
    if not isinstance(t, dict):
        raise SettingsError(message)
    days = dict(DEFAULT_CHECK_DAYS)
    for key, value in t.items():
        if key not in DEFAULT_CHECK_DAYS or type(value) is not int or not 1 <= value <= 90:
            raise SettingsError(message)
        days[key] = value
    return days


def _platforms(entries) -> tuple[JobPlatform, ...]:
    if not isinstance(entries, list) or not all(isinstance(e, dict) for e in entries):
        raise SettingsError("jobs.platforms must be a list of [[jobs.platforms]] entries.")
    if not 1 <= len(entries) <= _PLATFORMS_MAX:
        raise SettingsError(
            f"[jobs] needs at least one platform and at most {_PLATFORMS_MAX} ([[jobs.platforms]])."
        )
    platforms = tuple(_platform(e, n) for n, e in enumerate(entries, start=1))
    ids = [p.id for p in platforms]
    if len(set(ids)) != len(ids):
        raise SettingsError("Each entry in jobs.platforms needs a different id.")
    return platforms


def _platform(t: dict, n: int) -> JobPlatform:
    where = f"jobs.platforms (entry {n})"
    _only_keys(t, where, {"id", "name", "url", "start_status"})
    missing = sorted({"id", "name", "url"} - set(t))
    if missing:
        raise SettingsError(f"Missing setting(s) in {where}: {', '.join(missing)}.")
    ident = t["id"]
    if not isinstance(ident, str) or not _ID.fullmatch(ident):
        raise SettingsError(
            f"{where}.id must be lowercase letters, digits or _ (up to 31), starting with a letter."
        )
    name = _text(t, where, "name")
    if len(name) > _NAME_MAX:
        raise SettingsError(f"{where}.name must be at most {_NAME_MAX} characters.")
    url = t["url"]
    if not isinstance(url, str) or not url.startswith("https://") or len(url) > _URL_MAX:
        raise SettingsError(f"{where}.url must start with https:// (up to {_URL_MAX} characters).")
    status = t.get("start_status", "not_applied")
    if status not in STATUSES:
        raise SettingsError(f"{where}.start_status must be one of: {', '.join(STATUSES)}.")
    return JobPlatform(id=ident, name=name, url=url, start_status=status)
