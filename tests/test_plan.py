"""Tests for the Daily plan's saved weeks (src/aicity/plan.py).

Fixed dates: "today" is Wednesday 2026-11-25, so this week starts Monday 2026-11-23.
Every database is temporary; settings rules are built here, never read from a file.
"""

from datetime import UTC, date, datetime, time

import pytest

from aicity.db import DbKind, open_database
from aicity.plan import BlockNotFound, NewBlock, PlanError, PlanStore, blocks_for_week, monday_of
from aicity.settings import BlockRule, PlanSettings

TODAY = date(2026, 11, 25)
THIS_MONDAY = date(2026, 11, 23)
NEXT_MONDAY = date(2026, 11, 30)
NOW = datetime(2026, 11, 25, 15, 0, tzinfo=UTC)

COMMUTE = BlockRule("Commute", "commute", (0, 1), time(7, 30), time(8, 0))
WORK = BlockRule("Work", "work", (0, 1, 2, 3, 4), time(9), time(12))
GYM = BlockRule("Gym", "gym", (0, 1, 2, 3, 4), time(12), time(13))
RULES = PlanSettings(blocks=(WORK, COMMUTE, GYM))


class FakeClock:
    def __init__(self) -> None:
        self.now = NOW

    def __call__(self) -> datetime:
        return self.now


@pytest.fixture
def conn(tmp_path):
    c = open_database(tmp_path / "personal.db", DbKind.PERSONAL)
    yield c
    c.close()


@pytest.fixture
def store(conn):
    return PlanStore(conn, clock=FakeClock())


def day_blocks(week, day: str):
    return dict(week.days)[day]


def titles(week, day: str) -> list[str]:
    return [b.title for b in day_blocks(week, day)]


# --- Building a week ---------------------------------------------------------


def test_monday_of():
    assert monday_of(TODAY) == THIS_MONDAY
    assert monday_of(THIS_MONDAY) == THIS_MONDAY
    assert monday_of(date(2026, 11, 29)) == THIS_MONDAY
    assert monday_of(date(2026, 12, 1)) == NEXT_MONDAY


def test_blocks_for_week():
    blocks = blocks_for_week(PlanSettings(blocks=(WORK, COMMUTE)), THIS_MONDAY)
    assert len(blocks) == 7
    assert blocks[0] == NewBlock(
        THIS_MONDAY, time(7, 30), time(8), "Commute", "commute", "commute|Commute"
    )
    assert blocks[1] == NewBlock(THIS_MONDAY, time(9), time(12), "Work", "work", "work|Work")
    assert [b.day for b in blocks] == sorted(b.day for b in blocks)
    assert {b.day for b in blocks} == {date(2026, 11, d) for d in range(23, 28)}


def test_ensure_week_creates_once(store, conn):
    first = store.ensure_week(THIS_MONDAY, RULES, TODAY)
    second = store.ensure_week(THIS_MONDAY, RULES, TODAY)
    assert first == second
    assert conn.execute("SELECT count(*) FROM plan_weeks").fetchone()[0] == 1
    assert conn.execute("SELECT count(*) FROM plan_blocks").fetchone()[0] == 12
    assert titles(first, "2026-11-23") == ["Commute", "Work", "Gym"]
    assert titles(first, "2026-11-25") == ["Work", "Gym"]
    assert first.week_start == "2026-11-23"
    assert first.checked_in is False


def test_ensure_week_creates_this_and_next_week_only(store, conn):
    assert store.ensure_week(THIS_MONDAY, RULES, TODAY) is not None
    assert store.ensure_week(NEXT_MONDAY, RULES, TODAY) is not None
    assert store.ensure_week(date(2026, 12, 7), RULES, TODAY) is None
    assert store.ensure_week(date(2026, 11, 16), RULES, TODAY) is None
    assert conn.execute("SELECT count(*) FROM plan_weeks").fetchone()[0] == 2


def test_on_sunday_next_week_can_be_created(store):
    assert store.ensure_week(NEXT_MONDAY, RULES, date(2026, 11, 29)) is not None


def test_a_saved_past_week_can_still_be_read(store):
    store.ensure_week(THIS_MONDAY, RULES, TODAY)
    later = date(2026, 12, 9)
    assert store.ensure_week(THIS_MONDAY, RULES, later) == store.get_week(THIS_MONDAY)


def test_ensure_week_refuses_a_non_monday(store):
    with pytest.raises(PlanError):
        store.ensure_week(TODAY, RULES, TODAY)


def test_get_week_of_an_unsaved_week_is_none(store):
    assert store.get_week(THIS_MONDAY) is None


def test_week_always_has_seven_days(store):
    week = store.ensure_week(THIS_MONDAY, PlanSettings(blocks=()), TODAY)
    assert [d for d, _ in week.days] == [f"2026-11-{d}" for d in range(23, 30)]
    assert all(blocks == [] for _, blocks in week.days)


def test_block_fields(store):
    week = store.ensure_week(THIS_MONDAY, RULES, TODAY)
    gym = day_blocks(week, "2026-11-25")[1]
    assert (gym.day, gym.start, gym.end, gym.title, gym.kind) == (
        "2026-11-25",
        "12:00",
        "13:00",
        "Gym",
        "gym",
    )
    assert (gym.source, gym.status, gym.edited) == ("settings", "planned", False)


def test_unknown_block_is_not_found(store):
    with pytest.raises(BlockNotFound):
        store.get_block(999)
