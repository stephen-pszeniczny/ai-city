"""Opportunity Office settings: the optional [jobs] section.

Search profiles hold the filters, keywords and (for now) the skills list scoring
compares against. Sources are official public job lists the Sunday scan reads.
Platforms are the AI-training platforms on the roster. Real values live in the
private settings file; settings.example.toml has made-up ones.
"""

import re
from dataclasses import dataclass
from datetime import time
from decimal import Decimal

from aicity.settings import (
    DAY_CODES,
    SettingsError,
    _clock_time,
    _decimal,
    _only_keys,
    _text,
)

STAGES = ("not_joined", "applied", "assessment", "active", "quiet")
SOURCE_KINDS = ("greenhouse", "ashby", "lever")
JOB_TYPES = ("contract", "part_time", "temporary", "freelance")

_ID = re.compile(r"[a-z][a-z0-9_]{0,30}")
_BOARD = re.compile(r"[A-Za-z0-9_-]{1,60}")
_NAME_MAX = 60
_WORDS_MAX = 50
_WORD_LEN = 60
_URL_MAX = 500


@dataclass(frozen=True)
class JobProfile:
    id: str
    name: str
    active: bool
    pay_floor_usd: Decimal
    pay_preferred_usd: Decimal
    hours: tuple[int, int]
    job_types: tuple[str, ...]
    title_words: tuple[str, ...]
    exclude_words: tuple[str, ...]
    location_ok: tuple[str, ...]
    skills: tuple[str, ...]
    gap_words: tuple[str, ...]


@dataclass(frozen=True)
class JobSource:
    id: str
    name: str
    kind: str
    board: str
    profiles: tuple[str, ...]
    enabled: bool


@dataclass(frozen=True)
class JobPlatform:
    id: str
    name: str
    url: str
    start_stage: str


@dataclass(frozen=True)
class JobsSettings:
    scan_day: int
    scan_time: time
    top_n: int
    follow_up_days: int
    roll_off_days: int
    profiles: tuple[JobProfile, ...]
    sources: tuple[JobSource, ...]
    platforms: tuple[JobPlatform, ...]


def parse_jobs(t) -> JobsSettings:
    """Check the [jobs] table and turn it into JobsSettings."""
    if not isinstance(t, dict):
        raise SettingsError("[jobs] must be a table.")
    where = "[jobs]"
    _only_keys(
        t,
        where,
        {
            "scan_day",
            "scan_time",
            "top_n",
            "follow_up_days",
            "roll_off_days",
            "profiles",
            "sources",
            "platforms",
        },
    )
    scan_day = t.get("scan_day", "sun")
    if scan_day not in DAY_CODES:
        raise SettingsError(f"jobs.scan_day must be one of: {', '.join(DAY_CODES)}.")
    scan_time = _clock_time(t, "jobs", "scan_time") if "scan_time" in t else time(19, 0)
    profiles = _list(t, "profiles", _profile)
    if not profiles:
        raise SettingsError("[jobs] needs at least one profile ([[jobs.profiles]]).")
    _unique(profiles, "jobs.profiles")
    known = {p.id for p in profiles}
    sources = _list(t, "sources", lambda s, n: _source(s, n, known))
    _unique(sources, "jobs.sources")
    platforms = _list(t, "platforms", _platform)
    _unique(platforms, "jobs.platforms")
    return JobsSettings(
        scan_day=DAY_CODES.index(scan_day),
        scan_time=scan_time,
        top_n=_whole(t, "jobs", "top_n", 1, 25, 10),
        follow_up_days=_whole(t, "jobs", "follow_up_days", 1, 60, 10),
        roll_off_days=_whole(t, "jobs", "roll_off_days", 30, 365, 90),
        profiles=profiles,
        sources=sources,
        platforms=platforms,
    )


# --- Entries ----------------------------------------------------------------


def _profile(t: dict, n: int) -> JobProfile:
    where = f"jobs.profiles (entry {n})"
    required = {"id", "name", "pay_floor_usd", "pay_preferred_usd", "hours", "skills"}
    optional = {"active", "job_types", "title_words", "exclude_words", "location_ok", "gap_words"}
    _required(t, where, required, optional)
    floor = _decimal(t, where, "pay_floor_usd")
    preferred = _decimal(t, where, "pay_preferred_usd")
    if floor < 0 or preferred < 0:
        raise SettingsError(f"{where}: pay amounts can't be negative.")
    if floor > preferred:
        raise SettingsError(f"{where}.pay_floor_usd must be at most pay_preferred_usd.")
    hours = t["hours"]
    if (
        not isinstance(hours, list)
        or len(hours) != 2
        or not all(type(h) is int and 1 <= h <= 60 for h in hours)
        or hours[0] > hours[1]
    ):
        raise SettingsError(f"{where}.hours must be [low, high], whole hours from 1 to 60.")
    job_types = t.get("job_types", list(JOB_TYPES))
    if (
        not isinstance(job_types, list)
        or not job_types
        or not all(j in JOB_TYPES for j in job_types)
        or len(set(job_types)) != len(job_types)
    ):
        raise SettingsError(
            f"{where}.job_types must be a list of different types from: {', '.join(JOB_TYPES)}."
        )
    skills = _words(t, where, "skills")
    if not skills:
        raise SettingsError(f"{where}.skills must be a list of 1 to {_WORDS_MAX} skills.")
    active = t.get("active", True)
    if not isinstance(active, bool):
        raise SettingsError(f"{where}.active must be true or false.")
    return JobProfile(
        id=_id(t, where),
        name=_name(t, where),
        active=active,
        pay_floor_usd=floor,
        pay_preferred_usd=preferred,
        hours=(hours[0], hours[1]),
        job_types=tuple(job_types),
        title_words=_words(t, where, "title_words"),
        exclude_words=_words(t, where, "exclude_words"),
        location_ok=_words(t, where, "location_ok"),
        skills=skills,
        gap_words=_words(t, where, "gap_words"),
    )


def _source(t: dict, n: int, known: set[str]) -> JobSource:
    where = f"jobs.sources (entry {n})"
    _required(t, where, {"id", "name", "kind", "board", "profiles"}, {"enabled"})
    if t["kind"] not in SOURCE_KINDS:
        raise SettingsError(f"{where}.kind must be one of: {', '.join(SOURCE_KINDS)}.")
    board = t["board"]
    if not isinstance(board, str) or not _BOARD.fullmatch(board):
        raise SettingsError(
            f"{where}.board must be the list's short name: letters, digits, - or _."
        )
    profiles = t["profiles"]
    if (
        not isinstance(profiles, list)
        or not profiles
        or not all(isinstance(p, str) for p in profiles)
    ):
        raise SettingsError(f"{where}.profiles must be a list of profile ids.")
    if any(p not in known for p in profiles):
        raise SettingsError(f"{where}.profiles names an unknown profile.")
    enabled = t.get("enabled", True)
    if not isinstance(enabled, bool):
        raise SettingsError(f"{where}.enabled must be true or false.")
    return JobSource(
        id=_id(t, where),
        name=_name(t, where),
        kind=t["kind"],
        board=board,
        profiles=tuple(profiles),
        enabled=enabled,
    )


def _platform(t: dict, n: int) -> JobPlatform:
    where = f"jobs.platforms (entry {n})"
    _required(t, where, {"id", "name", "url"}, {"start_stage"})
    url = t["url"]
    if not isinstance(url, str) or not url.startswith("https://") or len(url) > _URL_MAX:
        raise SettingsError(f"{where}.url must start with https:// (up to {_URL_MAX} characters).")
    stage = t.get("start_stage", "not_joined")
    if stage not in STAGES:
        raise SettingsError(f"{where}.start_stage must be one of: {', '.join(STAGES)}.")
    return JobPlatform(id=_id(t, where), name=_name(t, where), url=url, start_stage=stage)


# --- Helpers ----------------------------------------------------------------


def _list(t: dict, key: str, parse) -> tuple:
    entries = t.get(key, [])
    if not isinstance(entries, list) or not all(isinstance(e, dict) for e in entries):
        raise SettingsError(f"jobs.{key} must be a list of [[jobs.{key}]] entries.")
    return tuple(parse(e, n) for n, e in enumerate(entries, start=1))


def _unique(entries: tuple, where: str) -> None:
    ids = [e.id for e in entries]
    if len(set(ids)) != len(ids):
        raise SettingsError(f"Each entry in {where} needs a different id.")


def _required(t: dict, where: str, required: set[str], optional: set[str]) -> None:
    _only_keys(t, where, required | optional)
    missing = sorted(required - set(t))
    if missing:
        raise SettingsError(f"Missing setting(s) in {where}: {', '.join(missing)}.")


def _id(t: dict, where: str) -> str:
    value = t["id"]
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise SettingsError(
            f"{where}.id must be lowercase letters, digits or _ (up to 31), starting with a letter."
        )
    return value


def _name(t: dict, where: str) -> str:
    name = _text(t, where, "name")
    if len(name) > _NAME_MAX:
        raise SettingsError(f"{where}.name must be at most {_NAME_MAX} characters.")
    return name


def _words(t: dict, where: str, key: str) -> tuple[str, ...]:
    """A list of short texts, stored lowercase, without repeats."""
    words = t.get(key, [])
    if (
        not isinstance(words, list)
        or len(words) > _WORDS_MAX
        or not all(isinstance(w, str) and 1 <= len(w.strip()) <= _WORD_LEN for w in words)
    ):
        raise SettingsError(
            f"{where}.{key} must be a list of up to {_WORDS_MAX} texts "
            f"of up to {_WORD_LEN} characters."
        )
    seen: dict[str, None] = {}
    for w in words:
        seen.setdefault(w.strip().lower(), None)
    return tuple(seen)


def _whole(t: dict, section: str, key: str, low: int, high: int, default: int) -> int:
    value = t.get(key, default)
    if type(value) is not int or not low <= value <= high:
        raise SettingsError(f"{section}.{key} must be a whole number from {low} to {high}.")
    return value
