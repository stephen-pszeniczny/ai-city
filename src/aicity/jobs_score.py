"""Score a job posting against a search profile with simple rules (no AI).

Out of 100: skills 50, pay 25, title 15, hours 10. 70 or more is "strong", 45 or
more "maybe", anything lower "skip". A clear skip verdict is an idea from
career-ops (santifer/career-ops, MIT), rewritten here.

Hard filters drop a posting outright (not remote, not open to Canada, full-time,
known pay below the floor, an excluded word). Unclear things are kept with a
flag instead: pay not listed, a range straddling the floor, Canada unknown.
"""

import re
from dataclasses import dataclass
from decimal import Decimal

from aicity.jobs_settings import JobProfile
from aicity.jobs_text import Facts, Pay

SKILLS_POINTS = 50
PAY_POINTS = 25
TITLE_POINTS = 15
HOURS_POINTS = 10
PAY_FLOOR_POINTS = 15
PAY_STRADDLE_POINTS = 8
SKILLS_FOR_FULL_MARKS = 5
STRONG_FROM = 70
MAYBE_FROM = 45
MAX_GAPS = 5


@dataclass(frozen=True)
class Posting:
    title: str
    company: str
    location: str
    text: str
    pay: Pay
    facts: Facts


@dataclass(frozen=True)
class Score:
    keep: bool
    drop_reason: str | None
    score: int
    verdict: str
    matched: tuple[str, ...]
    gaps: tuple[str, ...]
    flags: tuple[str, ...]


def background_for(profile: JobProfile) -> tuple[str, ...]:
    """Steve's background that scoring compares against: the connection point.

    For now it's the profile's temporary skills list from settings. Flight
    School's Archive replaces it once that building exists (Phase 2).
    """
    return profile.skills


def hourly_usd(pay: Pay, usd_rate: Decimal | None) -> tuple[Decimal | None, Decimal | None] | None:
    """(low, high) in US dollars per hour, or None when pay can't be compared.

    usd_rate is Canadian dollars per US dollar (Bank of Canada). Yearly pay,
    other currencies, and CAD without a rate all count as "pay not listed".
    """
    if pay.unit != "hour" or pay.high is None or pay.currency not in ("USD", "CAD"):
        return None
    if pay.currency == "CAD" and not usd_rate:
        return None

    def dollars(cents: int | None) -> Decimal | None:
        if cents is None:
            return None
        value = Decimal(cents) / 100
        return value / usd_rate if pay.currency == "CAD" else value

    return dollars(pay.low), dollars(pay.high)


def score_posting(posting: Posting, profile: JobProfile, usd_rate: Decimal | None) -> Score:
    words = f"{posting.title}\n{posting.text}".lower()
    hourly = hourly_usd(posting.pay, usd_rate)
    reason = _drop_reason(posting, profile, words, hourly)
    background = background_for(profile)
    matched = tuple(s for s in background if _has(words, s))
    gaps = tuple(g for g in profile.gap_words if g not in background and _has(words, g))[:MAX_GAPS]
    flags = _flags(posting.facts, profile, hourly)
    points = (
        _skills_points(len(matched), len(background))
        + _pay_points(profile, hourly)
        + (TITLE_POINTS if any(_has(posting.title.lower(), w) for w in profile.title_words) else 0)
        + _hours_points(posting.facts.hours, profile.hours)
    )
    verdict = "strong" if points >= STRONG_FROM else "maybe" if points >= MAYBE_FROM else "skip"
    return Score(
        keep=reason is None,
        drop_reason=reason,
        score=points,
        verdict=verdict,
        matched=matched,
        gaps=gaps,
        flags=flags,
    )


# --- Parts ------------------------------------------------------------------


def _drop_reason(posting: Posting, profile: JobProfile, words: str, hourly) -> str | None:
    facts = posting.facts
    if facts.remote == "no":
        return "not_remote"
    if facts.canada_ok == "no":
        return "not_canada"
    if facts.job_type == "full_time":
        return "full_time"
    if hourly is not None and hourly[1] < profile.pay_floor_usd:
        return "below_floor"
    if any(_has(words, w) for w in profile.exclude_words):
        return "excluded_word"
    return None


def _flags(facts: Facts, profile: JobProfile, hourly) -> tuple[str, ...]:
    flags = []
    if hourly is None:
        flags.append("pay_not_listed")
    elif _straddles(profile, hourly):
        flags.append("straddles_floor")
    if facts.canada_ok == "unknown":
        flags.append("canada_unknown")
    return tuple(flags)


def _straddles(profile: JobProfile, hourly) -> bool:
    low, high = hourly
    return high >= profile.pay_floor_usd and (low is None or low < profile.pay_floor_usd)


def _skills_points(matched: int, listed: int) -> int:
    if listed == 0:
        return 0
    needed = min(listed, SKILLS_FOR_FULL_MARKS)
    return round(SKILLS_POINTS * min(matched, needed) / needed)


def _pay_points(profile: JobProfile, hourly) -> int:
    if hourly is None:
        return 0
    low, high = hourly
    if _straddles(profile, hourly):
        return PAY_STRADDLE_POINTS
    if low is not None and low >= profile.pay_preferred_usd:
        return PAY_POINTS
    if high >= profile.pay_floor_usd:
        return PAY_FLOOR_POINTS
    return 0


def _hours_points(hours: tuple[int, int] | None, wanted: tuple[int, int]) -> int:
    if hours is None or (hours[0] <= wanted[1] and wanted[0] <= hours[1]):
        return HOURS_POINTS
    return 0


def _has(text: str, phrase: str) -> bool:
    """A whole word or phrase, case already lowered."""
    return re.search(rf"(?<![a-z0-9]){re.escape(phrase)}(?![a-z0-9])", text) is not None
