"""Tests for "is the owner looking at the app?" (src/aicity/presence.py).

The page reports whether its window has focus each time it asks for the
notification list. Only a recent "looking" counts: a window left open behind
other apps, or closed without saying so, stops counting after 75 seconds.
"""

from datetime import UTC, datetime, timedelta

from aicity.presence import Presence

START = datetime(2026, 11, 18, 12, 0, tzinfo=UTC)


class Clock:
    def __init__(self) -> None:
        self.now = START

    def __call__(self) -> datetime:
        return self.now


def test_nobody_has_reported_means_not_looking():
    assert Presence(Clock()).looking() is False


def test_looking_report_counts_for_75_seconds():
    clock = Clock()
    p = Presence(clock)
    p.report(True)
    clock.now = START + timedelta(seconds=74)
    assert p.looking() is True
    clock.now = START + timedelta(seconds=76)
    assert p.looking() is False


def test_a_later_not_looking_report_wins():
    clock = Clock()
    p = Presence(clock)
    p.report(True)
    clock.now += timedelta(seconds=5)
    p.report(False)
    assert p.looking() is False
