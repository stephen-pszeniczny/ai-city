"""Sun and moon maths for day and night mode, worked out on this Mac.

Nothing here touches the internet. Sunrise and sunset use the NOAA general
solar position method (good to about a minute at most latitudes), from the
latitude, longitude and time zone in the private settings file. The moon
phase uses the average length of a lunar month counted from a known new moon
(good to about half a day, plenty for drawing it).

"Today" always means the day at the settings' location, never the UTC date,
so the evening west of Greenwich isn't mistaken for the next day.
"""

import math
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from aicity.settings import Location

# The sun counts as up while its centre is above this angle from straight overhead:
# 90° plus a bit for the sun's size and the air bending its light.
_SUNRISE_ZENITH = math.radians(90.833)

_LUNAR_MONTH_DAYS = 29.530588853
_KNOWN_NEW_MOON = datetime(2000, 1, 6, 18, 14, tzinfo=UTC)


@dataclass(frozen=True)
class SunTimes:
    """One day's sunrise and sunset, in the location's time zone.

    When the sun never rises (polar night) or never sets (midnight sun) that
    day, both times are None and `always` says which.
    """

    sunrise: datetime | None
    sunset: datetime | None
    always: Literal["day", "night"] | None


@dataclass(frozen=True)
class Daylight:
    """What the page needs: is it night now, when does that change, and the moon."""

    is_night: bool
    sunrise: datetime | None
    sunset: datetime | None
    next_change: datetime
    moon_phase: float


def sun_times(day: date, latitude: float, longitude: float, tz: ZoneInfo) -> SunTimes:
    """Sunrise and sunset on `day` (a local date at that place)."""
    # Fractional year in radians, taken at midday.
    g = 2 * math.pi / 365 * (day.timetuple().tm_yday - 1)
    # Equation of time (minutes) and the sun's declination (radians).
    eqtime = 229.18 * (
        0.000075
        + 0.001868 * math.cos(g)
        - 0.032077 * math.sin(g)
        - 0.014615 * math.cos(2 * g)
        - 0.040849 * math.sin(2 * g)
    )
    decl = (
        0.006918
        - 0.399912 * math.cos(g)
        + 0.070257 * math.sin(g)
        - 0.006758 * math.cos(2 * g)
        + 0.000907 * math.sin(2 * g)
        - 0.002697 * math.cos(3 * g)
        + 0.00148 * math.sin(3 * g)
    )
    lat = math.radians(latitude)
    cos_ha = math.cos(_SUNRISE_ZENITH) / (math.cos(lat) * math.cos(decl)) - math.tan(
        lat
    ) * math.tan(decl)
    if cos_ha > 1:
        return SunTimes(None, None, "night")
    if cos_ha < -1:
        return SunTimes(None, None, "day")

    ha = math.degrees(math.acos(cos_ha))
    midnight_utc = datetime.combine(day, time(0), tzinfo=UTC)

    def at(minutes: float) -> datetime:
        return (midnight_utc + timedelta(minutes=minutes)).astimezone(tz)

    sunrise = at(720 - 4 * (longitude + ha) - eqtime)
    sunset = at(720 - 4 * (longitude - ha) - eqtime)
    return SunTimes(sunrise, sunset, None)


def moon_phase(at: datetime) -> float:
    """Where the moon is in its cycle: 0 new, 0.5 full, just under 1 almost new again."""
    days = (at - _KNOWN_NEW_MOON).total_seconds() / 86400
    return (days / _LUNAR_MONTH_DAYS) % 1.0


def daylight_at(now: datetime, location: Location) -> Daylight:
    """Day or night at `location` right now, and when that next changes."""
    if now.tzinfo is None:
        raise ValueError("The time must include its time zone.")
    tz = ZoneInfo(location.timezone)
    local = now.astimezone(tz)
    today = local.date()

    def times(day: date) -> SunTimes:
        return sun_times(day, location.latitude, location.longitude, tz)

    def next_midnight(day: date) -> datetime:
        return datetime.combine(day + timedelta(days=1), time(0), tzinfo=tz)

    t = times(today)
    phase = moon_phase(now)
    if t.sunrise is None or t.sunset is None:
        # No sunrise or sunset today: check again at midnight.
        return Daylight(t.always == "night", None, None, next_midnight(today), phase)

    if local < t.sunrise:
        return Daylight(True, t.sunrise, t.sunset, t.sunrise, phase)
    if local < t.sunset:
        return Daylight(False, t.sunrise, t.sunset, t.sunset, phase)
    tomorrow = times(today + timedelta(days=1)).sunrise or next_midnight(today)
    return Daylight(True, t.sunrise, t.sunset, tomorrow, phase)
