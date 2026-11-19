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


# --- Edits -------------------------------------------------------------------

THU = date(2026, 11, 26)


@pytest.fixture
def week(store):
    return store.ensure_week(THIS_MONDAY, RULES, TODAY)


def block_on(store, day: str, title: str):
    return next(b for b in day_blocks(store.get_week(THIS_MONDAY), day) if b.title == title)


def test_add_edit_remove_block(store, conn, week):
    hockey = store.add_block(THIS_MONDAY, THU, time(21), time(22), "Hockey", "event", TODAY)
    assert (hockey.source, hockey.kind, hockey.start, hockey.end) == ("added", "event", "21:00", "22:00")
    assert titles(store.get_week(THIS_MONDAY), "2026-11-26") == ["Work", "Gym", "Hockey"]

    renamed = store.edit_block(hockey.id, TODAY, title="Hockey (away)")
    assert renamed.title == "Hockey (away)"
    assert renamed.edited is False  # added blocks are Steve's anyway

    store.remove_block(hockey.id, TODAY)
    assert "Hockey (away)" not in titles(store.get_week(THIS_MONDAY), "2026-11-26")
    status = conn.execute("SELECT status FROM plan_blocks WHERE id = ?", (hockey.id,)).fetchone()
    assert status == ("removed",)


def test_adding_to_an_unsaved_week_is_refused(store):
    with pytest.raises(PlanError):
        store.add_block(NEXT_MONDAY, date(2026, 12, 1), time(9), time(10), "X", "event", TODAY)


def test_adding_outside_the_week_is_refused(store, week):
    with pytest.raises(PlanError):
        store.add_block(THIS_MONDAY, date(2026, 12, 1), time(9), time(10), "X", "event", TODAY)


def test_bad_block_data_is_refused(store, week):
    with pytest.raises(PlanError):
        store.add_block(THIS_MONDAY, THU, time(10), time(9), "X", "event", TODAY)
    with pytest.raises(PlanError):
        store.add_block(THIS_MONDAY, THU, time(9), time(10), "", "event", TODAY)


def test_editing_a_settings_block_marks_it_edited(store, week):
    work = block_on(store, "2026-11-26", "Work")
    edited = store.edit_block(work.id, TODAY, end=time(11))
    assert (edited.end, edited.edited) == ("11:00", True)


def test_editing_with_unknown_field_is_refused(store, week):
    work = block_on(store, "2026-11-26", "Work")
    with pytest.raises(PlanError):
        store.edit_block(work.id, TODAY, colour="red")


def test_moving_a_block_to_another_day_of_the_week(store, week):
    work = block_on(store, "2026-11-26", "Work")
    moved = store.edit_block(work.id, TODAY, day=date(2026, 11, 28))
    assert moved.day == "2026-11-28"
    with pytest.raises(PlanError):
        store.edit_block(work.id, TODAY, day=date(2026, 12, 1))


def test_past_days_are_read_only(store, week):
    monday_work = block_on(store, "2026-11-23", "Work")
    thursday_work = block_on(store, "2026-11-26", "Work")
    attempts = [
        lambda: store.add_block(THIS_MONDAY, THIS_MONDAY, time(18), time(19), "X", "event", TODAY),
        lambda: store.edit_block(monday_work.id, TODAY, title="Changed"),
        lambda: store.remove_block(monday_work.id, TODAY),
        lambda: store.edit_block(thursday_work.id, TODAY, day=THIS_MONDAY),
    ]
    for attempt in attempts:
        with pytest.raises(PlanError, match="Past days can't be changed."):
            attempt()


def test_a_removed_block_cannot_be_changed(store, week):
    work = block_on(store, "2026-11-26", "Work")
    store.remove_block(work.id, TODAY)
    with pytest.raises(PlanError, match="That block was removed."):
        store.edit_block(work.id, TODAY, title="Back")
    with pytest.raises(PlanError, match="That block was removed."):
        store.remove_block(work.id, TODAY)


def test_unknown_block_edit_is_not_found(store, week):
    with pytest.raises(BlockNotFound):
        store.edit_block(999, TODAY, title="X")


# --- Gym done / skipped ------------------------------------------------------


def test_gym_marking_window(store, week):
    wed_gym = block_on(store, "2026-11-25", "Gym")
    assert store.set_gym(wed_gym.id, "done", TODAY).status == "done"
    assert store.set_gym(wed_gym.id, "planned", TODAY).status == "planned"

    mon_gym = block_on(store, "2026-11-23", "Gym")
    assert store.set_gym(mon_gym.id, "skipped", TODAY).status == "skipped"

    thu_gym = block_on(store, "2026-11-26", "Gym")
    with pytest.raises(PlanError, match="on or after its day"):
        store.set_gym(thu_gym.id, "done", TODAY)

    assert store.set_gym(mon_gym.id, "done", date(2026, 11, 30)).status == "done"
    with pytest.raises(PlanError, match="last 7 days"):
        store.set_gym(mon_gym.id, "done", date(2026, 12, 1))

    with pytest.raises(PlanError):
        store.set_gym(block_on(store, "2026-11-25", "Work").id, "done", TODAY)
    with pytest.raises(PlanError):
        store.set_gym(wed_gym.id, "removed", TODAY)


def test_marking_gym_does_not_count_as_editing(store, week):
    wed_gym = block_on(store, "2026-11-25", "Gym")
    assert store.set_gym(wed_gym.id, "done", TODAY).edited is False


# --- Rebuild -----------------------------------------------------------------


def test_rebuild_keeps_steves_choices(store, week):
    store.remove_block(block_on(store, "2026-11-26", "Gym").id, TODAY)
    store.edit_block(block_on(store, "2026-11-26", "Work").id, TODAY, end=time(11, 30))
    store.set_gym(block_on(store, "2026-11-25", "Gym").id, "done", TODAY)
    store.add_block(THIS_MONDAY, date(2026, 11, 27), time(21), time(22), "Hockey", "event", TODAY)
    before_monday = day_blocks(store.get_week(THIS_MONDAY), "2026-11-23")

    later_gym = BlockRule("Gym", "gym", (0, 1, 2, 3, 4), time(12, 30), time(13, 30))
    rebuilt = store.rebuild_week(THIS_MONDAY, PlanSettings(blocks=(WORK, COMMUTE, later_gym)), TODAY)

    assert titles(rebuilt, "2026-11-26") == ["Work"]
    assert day_blocks(rebuilt, "2026-11-26")[0].end == "11:30"
    wed_gym = next(b for b in day_blocks(rebuilt, "2026-11-25") if b.kind == "gym")
    assert (wed_gym.status, wed_gym.start) == ("done", "12:00")
    fri = day_blocks(rebuilt, "2026-11-27")
    assert [(b.title, b.start) for b in fri] == [("Work", "09:00"), ("Gym", "12:30"), ("Hockey", "21:00")]
    assert day_blocks(rebuilt, "2026-11-23") == before_monday


def test_rebuild_twice_is_stable(store, week):
    once = store.rebuild_week(THIS_MONDAY, RULES, TODAY)
    twice = store.rebuild_week(THIS_MONDAY, RULES, TODAY)
    shape = lambda w: [(d, [(b.title, b.start, b.end) for b in bs]) for d, bs in w.days]
    assert shape(once) == shape(twice) == shape(week)


def test_rebuild_adds_new_rules_and_drops_deleted_ones(store, week):
    walk = BlockRule("Walk", "other", (0, 1, 2, 3, 4, 5, 6), time(18), time(18, 30))
    rebuilt = store.rebuild_week(THIS_MONDAY, PlanSettings(blocks=(WORK, walk)), TODAY)
    assert titles(rebuilt, "2026-11-23") == ["Commute", "Work", "Gym"]  # past: untouched
    assert titles(rebuilt, "2026-11-25") == ["Work", "Walk"]
    assert titles(rebuilt, "2026-11-29") == ["Walk"]


def test_rebuild_of_an_unsaved_week_is_refused(store):
    with pytest.raises(PlanError):
        store.rebuild_week(THIS_MONDAY, RULES, TODAY)
