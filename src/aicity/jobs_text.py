"""Read pay and plain facts out of job posting text, with simple rules (no AI).

Used for pasted roles and for scanned postings. The rules lean towards "not
known" rather than guessing: a figure with no "per hour" or "per year" wording
is never treated as hourly pay, and a location that names no country leaves
"open to Canada" unknown.
"""

import re
from dataclasses import dataclass

_AMOUNT = r"\d{1,3}(?:,\d{3})+|\d+"
_PAY = re.compile(
    rf"""
    (?P<upto>up\s+to\s+)?
    (?:(?P<cur0>USD|CAD)\s?)?
    (?P<cur1>CA\$|C\$|US\$|\$|£|€)?\s?
    (?<![\d.,])(?P<a>{_AMOUNT})(?:\.(?P<ac>\d{{1,2}}))?\s?(?P<ak>k\b)?
    (?:\s?(?:-|–|—|to)\s?(?:CA\$|C\$|US\$|\$|£|€)?\s?
       (?P<b>{_AMOUNT})(?:\.(?P<bc>\d{{1,2}}))?\s?(?P<bk>k\b)?)?
    (?:\s?(?P<cur2>USD|CAD)\b)?
    (?:\s?(?P<unit>/\s?(?:hr|hour|h)\b|per\s+(?:hour|hr)\b|an\s+hour|hourly
                  |/\s?(?:yr|year)\b|per\s+year|a\s+year|annually|per\s+annum))?
    (?:\s?\(?(?P<cur3>USD|CAD)\b\)?)?
    """,
    re.IGNORECASE | re.VERBOSE,
)
_CURRENCY_GROUPS = ("cur0", "cur1", "cur2", "cur3")
_HOURS_RANGE = re.compile(r"(\d{1,2})\s?(?:-|–|to)\s?(\d{1,2})\s?(?:hours|hrs|h)\b", re.IGNORECASE)
_HOURS_UP_TO = re.compile(r"up\s+to\s+(\d{1,2})\s?(?:hours|hrs|h)\b", re.IGNORECASE)
_HOURS_ONE = re.compile(r"(\d{1,2})\s?(?:hours|hrs)\s?(?:per|a|/)\s?week", re.IGNORECASE)

_REMOTE = re.compile(r"\bremote\b|work from home|work from anywhere", re.IGNORECASE)
_ON_SITE = re.compile(r"\bon-?site\b|\bin[- ]office\b|\bhybrid\b", re.IGNORECASE)
_NOT_CANADA = re.compile(
    r"\b(?:cannot|can't|can not|unable to|not able to|not)\b[^.;]{0,40}\bcanada\b"
    r"|\b(?:us|u\.s\.|usa|united states)[- ]only\b"
    r"|must (?:be )?(?:based|located|reside) in the (?:us|u\.s\.|united states)",
    re.IGNORECASE,
)
_COUNTRIES = (
    "united states",
    "usa",
    "u.s.",
    "united kingdom",
    "uk",
    "india",
    "germany",
    "france",
    "spain",
    "mexico",
    "brazil",
    "philippines",
    "australia",
    "poland",
    "netherlands",
    "ireland",
)
_TYPE_WORDS = (
    ("part_time", r"\bpart[- ]time\b"),
    ("full_time", r"\bfull[- ]time\b"),
    ("contract", r"\bcontract(?:or)?\b"),
    ("freelance", r"\bfreelance(?:r)?\b"),
    ("temporary", r"\btemporary\b|\btemp\b"),
)
_TITLE_NOISE = re.compile(r"\b(?:part time|remote|contract|freelance|canada)\b")
_COMPANY_NOISE = re.compile(r"\b(?:inc|llc|ltd|corp|corporation|co|limited|gmbh)\b")


@dataclass(frozen=True)
class Pay:
    low: int | None  # cents per unit
    high: int | None
    currency: str | None  # USD | CAD | OTHER
    unit: str  # hour | year | unknown
    text: str  # the matched words, at most 80 characters ("" when none)


@dataclass(frozen=True)
class Facts:
    remote: str  # yes | no | unknown
    canada_ok: str
    job_type: str  # contract | part_time | temporary | freelance | full_time | unknown
    hours: tuple[int, int] | None  # per week


NO_PAY = Pay(None, None, None, "unknown", "")


def parse_pay(text: str) -> Pay:
    """The first pay figure in the text, preferring one that says per hour or per year."""
    # A figure counts as pay only with a currency sign or word next to it.
    matches = [m for m in _PAY.finditer(text) if any(m[g] for g in _CURRENCY_GROUPS)]
    if not matches:
        return NO_PAY
    match = next((m for m in matches if m["unit"]), matches[0])
    low = _cents(match["a"], match["ac"], match["ak"])
    high = _cents(match["b"], match["bc"], match["bk"]) if match["b"] else low
    if match["b"] and match["ak"] and not match["bk"]:
        high = _cents(match["b"], match["bc"], "k")  # "$90k-110" means 110k
    if match["bk"] and not match["ak"]:
        low = _cents(match["a"], match["ac"], "k")  # "$90-110k" means 90k
    unit = _unit(match["unit"], match["ak"] or match["bk"], high)
    if match["upto"] and not match["b"]:
        low = None
    return Pay(
        low, high, _currency(*(match[g] for g in _CURRENCY_GROUPS)), unit, match[0].strip()[:80]
    )


def read_facts(title: str, location: str, text: str, location_ok: tuple[str, ...]) -> Facts:
    everything = f"{title}\n{location}\n{text}"
    return Facts(
        remote=_remote(everything),
        canada_ok=_canada(location, everything, location_ok),
        job_type=_job_type(title, text),
        hours=_hours(text),
    )


def normalise_title(title: str) -> str:
    words = _plain(title)
    return " ".join(_TITLE_NOISE.sub(" ", words).split())


def normalise_company(name: str) -> str:
    return " ".join(_COMPANY_NOISE.sub(" ", _plain(name)).split())


# --- Helpers ----------------------------------------------------------------


def _plain(text: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", text.lower()).split())


def _cents(amount: str | None, cents: str | None, k: str | None) -> int | None:
    if amount is None:
        return None
    value = int(amount.replace(",", "")) * 100 + int((cents or "0").ljust(2, "0"))
    return value * 1000 if k else value


def _unit(words: str | None, k: str | None, high: int | None) -> str:
    if words:
        w = words.lower()
        return "year" if ("yr" in w or "year" in w or "annu" in w) else "hour"
    # No wording: thousands mean a yearly (or project) figure, never an hourly one.
    if k or (high is not None and high >= 100_000):
        return "year"
    return "unknown"


def _currency(*marks: str | None) -> str:
    both = " ".join(m for m in marks if m).upper()
    if "£" in both or "€" in both:
        return "OTHER"
    if "CA$" in both or "C$" in both or "CAD" in both:
        return "CAD"
    return "USD"


def _remote(text: str) -> str:
    if _REMOTE.search(text):
        return "yes"
    if _ON_SITE.search(text):
        return "no"
    return "unknown"


def _canada(location: str, everything: str, location_ok: tuple[str, ...]) -> str:
    if _NOT_CANADA.search(everything):
        return "no"
    place = location.lower()
    if "canada" in place or any(_has_word(place, w) for w in location_ok):
        return "yes"
    if any(_has_word(place, c) for c in _COUNTRIES):
        return "no"
    if "canada" in everything.lower():
        return "yes"
    return "unknown"


def _has_word(text: str, word: str) -> bool:
    return re.search(rf"(?<![a-z]){re.escape(word)}(?![a-z])", text) is not None


def _job_type(title: str, text: str) -> str:
    """Title first, then text. Any other type wins over a full-time mention
    ("Not a full-time role; contract" is a contract)."""
    for source in (title, text):
        found = [k for k, pattern in _TYPE_WORDS if re.search(pattern, source, re.IGNORECASE)]
        others = [k for k in found if k != "full_time"]
        if others:
            return others[0]
        if found:
            return "full_time"
    return "unknown"


def _hours(text: str) -> tuple[int, int] | None:
    if m := _HOURS_RANGE.search(text):
        low, high = int(m[1]), int(m[2])
        return (low, high) if 1 <= low <= high <= 80 else None
    if m := _HOURS_UP_TO.search(text):
        high = int(m[1])
        return (1, high) if 1 <= high <= 80 else None
    if m := _HOURS_ONE.search(text):
        n = int(m[1])
        return (n, n) if 1 <= n <= 80 else None
    return None
