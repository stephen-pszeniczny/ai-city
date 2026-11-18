"""Tests for the sun and moon maths behind day and night mode.

Places used here are public reference points only (the example settings
location at Greenwich, plus Tromsø and Vancouver), never a real user's.
Expected sunrise and sunset times are the published ones, within 3 minutes.
"""

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from aicity.settings import Location
from aicity.sky import daylight_at, moon_phase, sun_times

GREENWICH = (51.4779, 0.0, ZoneInfo("Europe/London"))  # the example settings location
TROMSO = (69.6492, 18.9553, ZoneInfo("Europe/Oslo"))  # public reference place, far north
VANCOUVER = (49.2827, -123.1207, ZoneInfo("America/Vancouver"))  # public reference place, west


def place(lat: float, lon: float, tz: ZoneInfo) -> Location:
    return Location(name="Reference", latitude=lat, longitude=lon, timezone=tz.key)


def assert_near(actual: datetime | None, hh: int, mm: int, minutes: int = 3) -> None:
    assert actual is not None
    got = actual.hour * 60 + actual.minute + actual.second / 60
    assert abs(got - (hh * 60 + mm)) <= minutes, f"{actual:%H:%M} is not near {hh:02}:{mm:02}"


def test_midsummer_greenwich():
    times = sun_times(date(2026, 6, 21), *GREENWICH)
    assert_near(times.sunrise, 4, 43)
    assert_near(times.sunset, 21, 21)
    assert times.always is None


def test_midwinter_greenwich():
    times = sun_times(date(2026, 12, 21), *GREENWICH)
    assert_near(times.sunrise, 8, 4)
    assert_near(times.sunset, 15, 54)


def test_clocks_going_forward():
    # UK clocks go forward on 2026-03-29: sunrise moves from about 05:47 GMT to about 06:45 BST.
    before = sun_times(date(2026, 3, 28), *GREENWICH)
    after = sun_times(date(2026, 3, 29), *GREENWICH)
    assert before.sunrise is not None and after.sunrise is not None
    assert before.sunrise.hour == 5
    assert after.sunrise.hour == 6
    assert after.sunrise.utcoffset() == timedelta(hours=1)


def test_polar_night():
    times = sun_times(date(2026, 12, 21), *TROMSO)
    assert times.sunrise is None and times.sunset is None
    assert times.always == "night"


def test_midnight_sun():
    times = sun_times(date(2026, 6, 21), *TROMSO)
    assert times.sunrise is None and times.sunset is None
    assert times.always == "day"


def phase_distance(a: float, b: float) -> float:
    d = abs(a - b) % 1
    return min(d, 1 - d)


def test_new_moon():
    assert phase_distance(moon_phase(datetime(2026, 2, 17, 12, 1, tzinfo=UTC)), 0.0) <= 0.04


def test_full_moon():
    assert phase_distance(moon_phase(datetime(2026, 3, 3, 11, 38, tzinfo=UTC)), 0.5) <= 0.04


def test_moon_phase_stays_in_range():
    for days in range(60):
        p = moon_phase(datetime(2026, 1, 1, tzinfo=UTC) + timedelta(days=days))
        assert 0 <= p < 1


LONDON = ZoneInfo("Europe/London")


def test_before_sunrise_is_night_and_next_change_is_sunrise():
    d = daylight_at(datetime(2026, 6, 21, 3, 0, tzinfo=LONDON), place(*GREENWICH))
    assert d.is_night is True
    assert d.next_change == d.sunrise
    assert_near(d.next_change, 4, 43)


def test_daytime_next_change_is_sunset():
    d = daylight_at(datetime(2026, 6, 21, 12, 0, tzinfo=LONDON), place(*GREENWICH))
    assert d.is_night is False
    assert d.next_change == d.sunset
    assert_near(d.next_change, 21, 21)


def test_after_sunset_next_change_is_tomorrows_sunrise():
    d = daylight_at(datetime(2026, 6, 21, 22, 30, tzinfo=LONDON), place(*GREENWICH))
    assert d.is_night is True
    assert d.next_change.date() == date(2026, 6, 22)
    assert_near(d.next_change, 4, 43)


def test_evening_west_of_greenwich_uses_the_local_day():
    # 03:00 UTC on the 22nd is 20:00 on the 21st in Vancouver, before its ~21:20 sunset.
    d = daylight_at(datetime(2026, 6, 22, 3, 0, tzinfo=UTC), place(*VANCOUVER))
    assert d.is_night is False
    assert d.sunset is not None
    assert d.sunset.date() == date(2026, 6, 21)
    assert d.next_change == d.sunset


def test_polar_next_change_is_next_local_midnight():
    oslo = ZoneInfo("Europe/Oslo")
    d = daylight_at(datetime(2026, 12, 21, 12, 0, tzinfo=oslo), place(*TROMSO))
    assert d.is_night is True
    assert d.sunrise is None and d.sunset is None
    assert d.next_change == datetime(2026, 12, 22, 0, 0, tzinfo=oslo)


def test_times_come_back_in_the_locations_zone():
    d = daylight_at(datetime(2026, 6, 21, 12, 0, tzinfo=UTC), place(*VANCOUVER))
    assert d.next_change.tzinfo is not None
    assert d.next_change.utcoffset() == timedelta(hours=-7)


def test_naive_time_is_refused():
    with pytest.raises(ValueError):
        daylight_at(datetime(2026, 6, 21, 12, 0), place(*GREENWICH))
