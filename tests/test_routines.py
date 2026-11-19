"""Tests for routines' daily ticks (src/aicity/routines.py).

"Today" is Sunday 2026-11-29. The routine runs Sunday to Thursday. Temporary databases only.
"""

from datetime import UTC, date, datetime, time

import pytest

from aicity.db import DbKind, open_database
from aicity.routines import RoutineDay, RoutineError, RoutineNotFound, RoutineStore, routines_on
from aicity.settings import Routine

SUNDAY = date(2026, 11, 29)
MONDAY = date(2026, 11, 30)
FRIDAY = date(2026, 11, 27)
PREP = Routine(
    "evening_prep",
    "Evening prep",
    (6, 0, 1, 2, 3),
    time(19),
    time(21, 30),
    ("Lunch packed", "Bag ready", "Keys out"),
)
MORNING = Routine("morning", "Morning", (4,), time(7), None, ("Water",))
ROUTINES = (PREP, MORNING)


@pytest.fixture
def store(tmp_path):
    conn = open_database(tmp_path / "personal.db", DbKind.PERSONAL)
    yield RoutineStore(conn, clock=lambda: datetime(2026, 11, 29, 20, 0, tzinfo=UTC))
    conn.close()


def items(day: RoutineDay) -> list[tuple[str, bool]]:
    return day.items


def test_routines_on():
    assert routines_on(ROUTINES, SUNDAY) == [PREP]
    assert routines_on(ROUTINES, FRIDAY) == [MORNING]


def test_day_view_starts_unticked(store):
    [view] = store.day_view(ROUTINES, SUNDAY)
    assert view == RoutineDay(
        id="evening_prep",
        title="Evening prep",
        shows_from="19:00",
        remind_at="21:30",
        items=[("Lunch packed", False), ("Bag ready", False), ("Keys out", False)],
        done=0,
        total=3,
    )


def test_tick_and_untick(store):
    view = store.set_tick(ROUTINES, "evening_prep", "Bag ready", True, SUNDAY, SUNDAY)
    assert (view.done, items(view)[1]) == (1, ("Bag ready", True))
    view = store.set_tick(ROUTINES, "evening_prep", "Bag ready", False, SUNDAY, SUNDAY)
    assert view.done == 0


def test_ticking_twice_and_unticking_an_unticked_item_are_harmless(store):
    store.set_tick(ROUTINES, "evening_prep", "Keys out", True, SUNDAY, SUNDAY)
    assert store.set_tick(ROUTINES, "evening_prep", "Keys out", True, SUNDAY, SUNDAY).done == 1
    assert store.set_tick(ROUTINES, "evening_prep", "Bag ready", False, SUNDAY, SUNDAY).done == 1


def test_yesterdays_ticks_do_not_count_today(store):
    for item in PREP.items:
        store.set_tick(ROUTINES, "evening_prep", item, True, SUNDAY, SUNDAY)
    [monday] = store.day_view(ROUTINES, MONDAY)
    assert monday.done == 0


def test_an_item_removed_from_settings_is_ignored(store):
    store.set_tick(ROUTINES, "evening_prep", "Keys out", True, SUNDAY, SUNDAY)
    shorter = (Routine(**{**PREP.__dict__, "items": ("Lunch packed", "Bag ready")}),)
    [view] = store.day_view(shorter, SUNDAY)
    assert (view.done, view.total) == (0, 2)


def test_unknown_routine_is_not_found(store):
    with pytest.raises(RoutineNotFound):
        store.set_tick(ROUTINES, "nope", "Water", True, SUNDAY, SUNDAY)


@pytest.mark.parametrize(
    ("routine_id", "item", "day", "message"),
    [
        ("evening_prep", "Lunch packed", MONDAY, "Only today's routines can be ticked."),
        (
            "evening_prep",
            "Lunch packed",
            date(2026, 11, 26),
            "Only today's routines can be ticked.",
        ),
        ("morning", "Water", SUNDAY, "That routine doesn't run on that day."),
        ("evening_prep", "Socks", SUNDAY, "That item isn't in the routine."),
    ],
)
def test_refusals(store, routine_id, item, day, message):
    with pytest.raises(RoutineError, match=message):
        store.set_tick(ROUTINES, routine_id, item, True, day, SUNDAY)
