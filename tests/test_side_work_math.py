"""Tests for the Vault's side-work maths: money, exchange and pay windows.

All dates and amounts are invented.
"""

from datetime import date
from decimal import Decimal

import pytest

from aicity.settings import PaySchedule
from aicity.side_work_math import (
    arrival_window,
    difference_cents,
    expected_cents,
    hours_to_minutes,
    is_overdue,
    money_to_cents,
    pay_period,
    set_aside_cents,
    to_cad_cents,
)

# Weeks run Saturday (weekday 5) to Friday; released 5-6 days after, lands 3-4 days later.
SCHED = PaySchedule("platform_a", "Platform A", 5, (5, 6), (3, 4))


def test_expected_pay_rounds_half_up():
    assert expected_cents(90, 4001) == 6002  # 1.5 h x $40.01 = 60.015
    assert expected_cents(60, 4000) == 4000


def test_expected_pay_needs_hours_and_rate():
    assert expected_cents(None, 4000) is None
    assert expected_cents(60, None) is None


def test_usd_to_cad_rounds_half_up():
    assert to_cad_cents(1000, "USD", Decimal("1.3725")) == 1373  # 13.725


def test_cad_needs_no_rate():
    assert to_cad_cents(1000, "CAD", None) == 1000


def test_usd_without_rate_is_unknown():
    assert to_cad_cents(1000, "USD", None) is None


def test_unknown_currency_is_refused():
    with pytest.raises(ValueError):
        to_cad_cents(1000, "EUR", Decimal("1.5"))


def test_set_aside_rounds_half_up():
    assert set_aside_cents(10001, Decimal("25")) == 2500  # 25.0025
    assert set_aside_cents(10002, Decimal("25")) == 2501  # 25.005


def test_week_runs_saturday_to_friday():
    assert pay_period(date(2026, 3, 11), SCHED) == (date(2026, 3, 7), date(2026, 3, 13))


def test_first_and_last_day_belong_to_their_week():
    assert pay_period(date(2026, 3, 7), SCHED) == (date(2026, 3, 7), date(2026, 3, 13))
    assert pay_period(date(2026, 3, 13), SCHED) == (date(2026, 3, 7), date(2026, 3, 13))
    assert pay_period(date(2026, 3, 14), SCHED)[0] == date(2026, 3, 14)


def test_arrival_window():
    # Ends Fri Mar 13: released Mar 18-19, lands Mar 21-23.
    assert arrival_window(date(2026, 3, 13), SCHED) == (date(2026, 3, 21), date(2026, 3, 23))


def test_overdue_only_after_latest_day():
    w = (date(2026, 3, 21), date(2026, 3, 23))
    assert not is_overdue(w, False, date(2026, 3, 23))
    assert is_overdue(w, False, date(2026, 3, 24))


def test_paid_or_unscheduled_is_never_overdue():
    w = (date(2026, 3, 21), date(2026, 3, 23))
    assert not is_overdue(w, True, date(2026, 4, 1))
    assert not is_overdue(None, False, date(2030, 1, 1))


def test_difference_uses_same_rate_both_sides():
    # USD work 100.00, paid as CAD 137.00; the rate that day was 1.3725, so expected 137.25.
    expected = to_cad_cents(10000, "USD", Decimal("1.3725"))
    assert difference_cents(expected, 13700) == -25


def test_difference_unknown_when_either_side_unknown():
    assert difference_cents(None, 100) is None
    assert difference_cents(100, None) is None


def test_hours():
    assert hours_to_minutes("1.5") == 90
    assert hours_to_minutes("0.25") == 15
    assert hours_to_minutes(" 168 ") == 10080
    assert hours_to_minutes("0.01") == 1  # 0.6 min rounds half up to 1


@pytest.mark.parametrize("bad", ["0", "-2", "168.01", "200", "12.345", "", "abc", "1:30", "NaN"])
def test_bad_hours_are_refused(bad):
    with pytest.raises(ValueError):
        hours_to_minutes(bad)


def test_money():
    assert money_to_cents("40") == 4000
    assert money_to_cents("1234.5") == 123450
    assert money_to_cents("0") == 0


@pytest.mark.parametrize("bad", ["-1", "12.345", "", "$40", "1,000", "abc", "1e3"])
def test_bad_money_is_refused(bad):
    with pytest.raises(ValueError):
        money_to_cents(bad)
