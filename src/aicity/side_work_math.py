"""The Vault's side-work maths: money, exchange rates and pay windows.

Every amount is whole cents and every rate an exact Decimal. All rounding
happens here, half up to the cent, so the same sum always gives the same
answer wherever it's shown.
"""

import re
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from aicity.settings import PaySchedule

CURRENCIES = ("CAD", "USD")
MAX_HOURS = 168  # one entry can be a whole week


def _round_cents(value: Decimal) -> int:
    return int(value.quantize(Decimal(1), rounding=ROUND_HALF_UP))


def rate_text(rate: Decimal) -> str:
    """A rate as stored: plain decimal text with at least one decimal place."""
    text = format(rate, "f")
    return text if "." in text else text + ".0"


# --- Money ---------------------------------------------------------------------------


def expected_cents(minutes: int | None, rate_cents: int | None) -> int | None:
    """Hours worked times the hourly rate, or None when either is unknown."""
    if minutes is None or rate_cents is None:
        return None
    return _round_cents(Decimal(minutes) * Decimal(rate_cents) / 60)


def to_cad_cents(amount_cents: int, currency: str, rate: Decimal | None) -> int | None:
    """An amount in CAD. USD needs the USD-to-CAD rate; without one the answer is None."""
    if currency not in CURRENCIES:
        raise ValueError("Currency must be CAD or USD.")
    if currency == "CAD":
        return amount_cents
    if rate is None:
        return None
    return _round_cents(Decimal(amount_cents) * rate)


def set_aside_cents(received_cad_cents: int, percent: Decimal) -> int:
    """The part of side income to keep aside for tax."""
    return _round_cents(Decimal(received_cad_cents) * percent / 100)


def difference_cents(expected_cad: int | None, received_cad: int | None) -> int | None:
    """Received minus expected (negative means paid short), or None if either is unknown."""
    if expected_cad is None or received_cad is None:
        return None
    return received_cad - expected_cad


# --- What the page sends ---------------------------------------------------------------


def hours_to_minutes(text: str) -> int:
    """Hours as typed ("1.5") to whole minutes. More than 0, at most 168, up to 2 decimals."""
    text = text.strip()
    if not re.fullmatch(r"\d+(\.\d{1,2})?", text):
        raise ValueError("Hours must be a number like 1.5 (up to 2 decimals).")
    hours = Decimal(text)
    if not Decimal(0) < hours <= MAX_HOURS:
        raise ValueError(f"Hours must be more than 0 and at most {MAX_HOURS}.")
    return _round_cents(hours * 60)


def money_to_cents(text: str) -> int:
    """An amount as typed ("40" or "1234.50") to whole cents. Not negative, up to 2 decimals."""
    text = text.strip()
    if not re.fullmatch(r"\d+(\.\d{1,2})?", text):
        raise ValueError("Amounts must be a number like 40 or 1234.50 (no $ or commas).")
    return int(Decimal(text) * 100)


# --- Pay windows ----------------------------------------------------------------------


def pay_period(worked_on: date, schedule: PaySchedule) -> tuple[date, date]:
    """The first and last day of the pay week that contains worked_on."""
    start = worked_on - timedelta(days=(worked_on.weekday() - schedule.week_starts) % 7)
    return start, start + timedelta(days=6)


def arrival_window(period_end: date, schedule: PaySchedule) -> tuple[date, date]:
    """The earliest and latest day the pay for a week ending period_end should land."""
    earliest = period_end + timedelta(days=schedule.release_after[0] + schedule.arrive_after[0])
    latest = period_end + timedelta(days=schedule.release_after[1] + schedule.arrive_after[1])
    return earliest, latest


def is_overdue(window: tuple[date, date] | None, paid: bool, today: date) -> bool:
    """Unpaid after the last day it could have landed. No window means never overdue."""
    return window is not None and not paid and today > window[1]
