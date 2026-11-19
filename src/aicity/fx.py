"""USD-to-CAD exchange rates from the Bank of Canada, kept in a local cache.

The only request is to the Bank of Canada's public Valet service: a currency
pair and a date range, nothing personal. Each day's rate is fetched once and
kept in fx_rates.

Weekends and holidays have no rate; they use the last business day before
(looking back up to 7 days). That fallback is only used for days a fetch
actually covered (fx_checked_days), so a failed fetch or a gap between opens
never quietly turns into an older rate: the day stays "rate pending" until a
fetch covers it or a rate is typed in by hand.
"""

import sqlite3
from collections.abc import Callable
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation

import httpx

from aicity.db import with_transaction
from aicity.side_work_math import rate_text

VALET_URL = "https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json"
TIMEOUT_S = 10
LOOK_BACK_DAYS = 7
MANUAL_RANGE = (Decimal("0.5"), Decimal(3))

Fetcher = Callable[[date, date], dict[date, Decimal]]


class RateUnavailable(Exception):
    """The Bank of Canada couldn't be reached or answered something unexpected."""


# --- Reading the cache ------------------------------------------------------------------


def rate_on(conn: sqlite3.Connection, day: date) -> tuple[Decimal, date] | None:
    """The rate for this day and the day it's from, or None if not known yet. Never fetches."""
    row = conn.execute(
        "SELECT rate, day FROM fx_rates WHERE currency = 'USD' AND day = ?", (day.isoformat(),)
    ).fetchone()
    if row is None:
        if not _was_checked(conn, day):
            return None
        row = conn.execute(
            "SELECT rate, day FROM fx_rates WHERE currency = 'USD' AND day < ? AND day >= ? "
            "ORDER BY day DESC LIMIT 1",
            (day.isoformat(), (day - timedelta(days=LOOK_BACK_DAYS)).isoformat()),
        ).fetchone()
        if row is None:
            return None
    return Decimal(row[0]), date.fromisoformat(row[1])


def latest_rate(conn: sqlite3.Connection) -> tuple[Decimal, date] | None:
    """The newest rate known, for estimating pay that hasn't arrived yet."""
    row = conn.execute(
        "SELECT rate, day FROM fx_rates WHERE currency = 'USD' ORDER BY day DESC LIMIT 1"
    ).fetchone()
    return None if row is None else (Decimal(row[0]), date.fromisoformat(row[1]))


def _was_checked(conn: sqlite3.Connection, day: date) -> bool:
    row = conn.execute(
        "SELECT 1 FROM fx_checked_days WHERE currency = 'USD' AND day = ?", (day.isoformat(),)
    ).fetchone()
    return row is not None


# --- Filling the cache -----------------------------------------------------------------


def refresh_rates(
    conn: sqlite3.Connection, days: set[date], fetch: Fetcher, *, today: date
) -> bool:
    """Fetch whatever these days still need, in one request. False if the fetch failed."""
    needed = [d for d in days if d <= today and rate_on(conn, d) is None]
    if not needed:
        return True
    start = min(needed) - timedelta(days=LOOK_BACK_DAYS)
    end = max(needed)
    try:
        rates = fetch(start, end)
    except RateUnavailable:
        return False
    stamp = _stamp()
    # Today's rate may not be published yet, so only past days count as checked.
    checked = min(end, today - timedelta(days=1))

    def work() -> None:
        conn.executemany(
            "INSERT OR IGNORE INTO fx_rates (currency, day, rate, source, fetched_at) "
            "VALUES ('USD', ?, ?, 'boc', ?)",
            [(d.isoformat(), rate_text(r), stamp) for d, r in rates.items()],
        )
        covered = [
            ((start + timedelta(days=i)).isoformat(),) for i in range((checked - start).days + 1)
        ]
        conn.executemany(
            "INSERT OR IGNORE INTO fx_checked_days (currency, day) VALUES ('USD', ?)", covered
        )

    with_transaction(conn, work, immediate=True)
    return True


def save_manual_rate(conn: sqlite3.Connection, day: date, rate: Decimal) -> None:
    """A rate typed in by hand, for when the Bank of Canada can't be reached."""
    if not rate.is_finite() or not MANUAL_RANGE[0] <= rate <= MANUAL_RANGE[1]:
        raise ValueError("That rate looks wrong: USD to CAD is usually between 0.5 and 3.")
    if rate.as_tuple().exponent < -6:
        raise ValueError("Use at most 6 decimals for a rate.")
    with_transaction(
        conn,
        lambda: conn.execute(
            "INSERT OR REPLACE INTO fx_rates (currency, day, rate, source, fetched_at) "
            "VALUES ('USD', ?, ?, 'manual', ?)",
            (day.isoformat(), rate_text(rate), _stamp()),
        ),
    )


def _stamp() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


# --- The Bank of Canada ----------------------------------------------------------------


def valet_fetcher(
    start: date, end: date, client: httpx.Client | None = None
) -> dict[date, Decimal]:
    """USD-to-CAD rates by day from the Bank of Canada's Valet service."""
    params = {"start_date": start.isoformat(), "end_date": end.isoformat()}
    try:
        if client is None:
            response = httpx.get(VALET_URL, params=params, timeout=TIMEOUT_S)
        else:
            response = client.get(VALET_URL, params=params, timeout=TIMEOUT_S)
        response.raise_for_status()
        return _read_observations(response.json())
    except (httpx.HTTPError, ValueError) as exc:
        raise RateUnavailable("The Bank of Canada rate couldn't be fetched.") from exc


def _read_observations(body) -> dict[date, Decimal]:
    try:
        rates = {}
        for obs in body["observations"]:
            rate = Decimal(obs["FXUSDCAD"]["v"])
            if not rate.is_finite() or rate <= 0:
                raise ValueError("bad rate")
            rates[date.fromisoformat(obs["d"])] = rate
        return rates
    except (KeyError, TypeError, ValueError, InvalidOperation) as exc:
        raise ValueError("Unexpected answer from the Bank of Canada.") from exc
