"""Tests for exchange rates: the local cache, weekend fallback and the Valet reader.

No test touches the network: fetchers are fakes, and the Valet reader runs
against httpx's in-memory transport. Every rate is invented.
"""

from datetime import date
from decimal import Decimal

import httpx
import pytest

from aicity.db import DbKind, open_database
from aicity.fx import RateUnavailable, rate_on, refresh_rates, save_manual_rate, valet_fetcher

FRI, SAT, SUN, MON = date(2026, 3, 20), date(2026, 3, 21), date(2026, 3, 22), date(2026, 3, 23)
TODAY = date(2026, 3, 25)


@pytest.fixture
def conn(tmp_path):
    c = open_database(tmp_path / "sample.db", DbKind.SAMPLE)
    yield c
    c.close()


class FakeFetcher:
    def __init__(self, rates: dict[date, Decimal] | None = None, fail: bool = False):
        self.rates = rates or {}
        self.fail = fail
        self.calls: list[tuple[date, date]] = []

    def __call__(self, start: date, end: date) -> dict[date, Decimal]:
        self.calls.append((start, end))
        if self.fail:
            raise RateUnavailable("offline")
        return {d: r for d, r in self.rates.items() if start <= d <= end}


def test_weekend_uses_the_friday_rate(conn):
    fetch = FakeFetcher({FRI: Decimal("1.3725")})
    assert refresh_rates(conn, {SUN}, fetch, today=TODAY)
    assert rate_on(conn, SUN) == (Decimal("1.3725"), FRI)


def test_monday_holiday_uses_the_friday_rate(conn):
    fetch = FakeFetcher({FRI: Decimal("1.3725")})
    refresh_rates(conn, {MON}, fetch, today=TODAY)
    assert rate_on(conn, MON) == (Decimal("1.3725"), FRI)


def test_exact_day_is_preferred(conn):
    fetch = FakeFetcher({FRI: Decimal("1.3725"), MON: Decimal("1.3800")})
    refresh_rates(conn, {MON}, fetch, today=TODAY)
    assert rate_on(conn, MON) == (Decimal("1.3800"), MON)


def test_cached_day_makes_no_fetch(conn):
    fetch = FakeFetcher({FRI: Decimal("1.3725")})
    refresh_rates(conn, {SAT}, fetch, today=TODAY)  # checks the week up to Saturday
    refresh_rates(conn, {FRI, SAT}, fetch, today=TODAY)
    assert len(fetch.calls) == 1


def test_failed_fetch_returns_false_and_stores_nothing(conn):
    assert refresh_rates(conn, {FRI}, FakeFetcher(fail=True), today=TODAY) is False
    assert rate_on(conn, FRI) is None


def test_unchecked_day_never_falls_back_to_an_older_rate(conn):
    # Friday is cached, but Monday was never checked (the fetch failed): no guessing.
    refresh_rates(conn, {FRI}, FakeFetcher({FRI: Decimal("1.3725")}), today=SAT)
    refresh_rates(conn, {MON}, FakeFetcher(fail=True), today=TODAY)
    assert rate_on(conn, MON) is None


def test_todays_rate_may_not_be_out_yet(conn):
    # Before the day's rate is published, today stays pending instead of using yesterday's.
    refresh_rates(conn, {MON}, FakeFetcher({FRI: Decimal("1.3725")}), today=MON)
    assert rate_on(conn, MON) is None


def test_no_rate_within_seven_days_is_none(conn):
    refresh_rates(conn, {MON}, FakeFetcher({date(2026, 3, 10): Decimal("1.3")}), today=TODAY)
    assert rate_on(conn, MON) is None


def test_future_days_are_not_fetched(conn):
    fetch = FakeFetcher()
    refresh_rates(conn, {date(2026, 4, 30)}, fetch, today=TODAY)
    assert fetch.calls == []


def test_manual_rate_is_used(conn):
    save_manual_rate(conn, MON, Decimal("1.38"))
    assert rate_on(conn, MON) == (Decimal("1.38"), MON)


@pytest.mark.parametrize("bad", ["0", "0.49", "3.01", "10", "1.1234567"])
def test_unlikely_manual_rate_is_refused(conn, bad):
    with pytest.raises(ValueError):
        save_manual_rate(conn, MON, Decimal(bad))


VALET_BODY = {
    "seriesDetail": {"FXUSDCAD": {"label": "USD/CAD"}},
    "observations": [
        {"d": "2026-03-19", "FXUSDCAD": {"v": "1.3701"}},
        {"d": "2026-03-20", "FXUSDCAD": {"v": "1.3725"}},
    ],
}


def client_answering(status: int, body) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "www.bankofcanada.ca"
        assert request.url.params["start_date"] == "2026-03-19"
        return httpx.Response(status, json=body)

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_valet_reader_gives_exact_rates():
    rates = valet_fetcher(date(2026, 3, 19), FRI, client=client_answering(200, VALET_BODY))
    assert rates == {date(2026, 3, 19): Decimal("1.3701"), FRI: Decimal("1.3725")}


@pytest.mark.parametrize(
    ("status", "body"),
    [
        (500, VALET_BODY),
        (200, {"unexpected": True}),
        (200, {"observations": [{"d": "2026-03-20", "FXUSDCAD": {"v": "lots"}}]}),
        (200, {"observations": [{"d": "nope", "FXUSDCAD": {"v": "1.3"}}]}),
    ],
)
def test_valet_problems_are_rate_unavailable(status, body):
    with pytest.raises(RateUnavailable):
        valet_fetcher(date(2026, 3, 19), FRI, client=client_answering(status, body))
