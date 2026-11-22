"""Opportunity Office store: the platform roster, check rounds, profiles and the log.

Every platform and project here is made up. Times are 15:00 UTC (daytime on the Mac),
so the Mac's local date is the same day.
"""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from aicity.db import DbKind, open_database
from aicity.jobs_settings import DEFAULT_CHECK_DAYS, JobPlatform, JobsSettings
from aicity.jobs_store import JobsConflict, JobsError, JobsNotFound, JobsStore

NOW = datetime(2026, 11, 29, 15, 0, tzinfo=UTC)

SETTINGS = JobsSettings(
    pay_floor_usd=Decimal(30),
    pay_preferred_usd=Decimal(40),
    master_resume_label="v2",
    check_days=dict(DEFAULT_CHECK_DAYS),
    platforms=(
        JobPlatform("platform_a", "Platform A", "https://example.com/a", "active"),
        JobPlatform("platform_b", "Platform B", "https://example.com/b", "applied"),
        JobPlatform("platform_c", "Platform C", "https://example.com/c", "not_applied"),
    ),
)


class Clock:
    def __init__(self, now: datetime) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now


@pytest.fixture
def conn(tmp_path):
    c = open_database(tmp_path / "sample.db", DbKind.SAMPLE)
    yield c
    c.close()


@pytest.fixture
def clock():
    return Clock(NOW)


@pytest.fixture
def store(conn, clock):
    return JobsStore(conn, SETTINGS, clock=clock)


def card(store, platform_id):
    return next(c for c in store.platforms() if c.id == platform_id)


def fewer_platforms() -> JobsSettings:
    return JobsSettings(**{**SETTINGS.__dict__, "platforms": SETTINGS.platforms[:2]})


# --- Roster and check rounds ------------------------------------------------------------


def test_start_status_from_settings_with_no_rows(store):
    cards = store.platforms()
    assert [(c.id, c.status, c.status_at) for c in cards] == [
        ("platform_a", "active", None),
        ("platform_b", "applied", None),
        ("platform_c", "not_applied", None),
    ]
    assert cards[0].name == "Platform A" and cards[0].url == "https://example.com/a"


def test_new_platform_is_due_today_if_it_has_an_interval(store):
    a, b = card(store, "platform_a"), card(store, "platform_b")
    assert (a.due, a.next_check_on) == (True, "2026-11-29")
    assert (b.due, b.next_check_on) == (True, "2026-11-29")
    assert [c.id for c in store.due()] == ["platform_a", "platform_b"]
    assert store.due_count() == 2


def test_not_applied_is_never_due(store):
    c = card(store, "platform_c")
    assert (c.due, c.next_check_on) == (False, None)


def test_rejected_is_never_due(store):
    store.set_status("platform_a", "rejected")
    assert card(store, "platform_a").due is False


def test_platform_removed_from_settings_is_not_shown(conn, clock):
    JobsStore(conn, SETTINGS, clock=clock).record_check("platform_c", "nothing")
    ids = [c.id for c in JobsStore(conn, fewer_platforms(), clock=clock).platforms()]
    assert ids == ["platform_a", "platform_b"]


def test_a_check_moves_the_next_check_on(store, clock):
    after = store.record_check("platform_a", "nothing")
    assert (after.due, after.next_check_on) == (False, "2026-12-02")  # active: 3 days
    assert after.last_checked_at == "2026-11-29T15:00:00Z"
    clock.now += timedelta(days=3)
    assert card(store, "platform_a").due is True


def test_status_change_resets_the_check_clock(store, clock):
    store.record_check("platform_a", "found")
    clock.now += timedelta(days=1)
    after = store.set_status("platform_a", "paused")
    assert after.status == "paused"
    assert after.status_at == "2026-11-30T15:00:00Z"
    assert after.next_check_on == "2026-12-30"  # paused: 30 days from the change


def test_record_check_appends_a_row(store, conn):
    store.record_check("platform_a", "nothing")
    store.record_check("platform_a", "found")
    assert conn.execute("SELECT outcome FROM platform_checks ORDER BY id").fetchall() == [
        ("nothing",),
        ("found",),
    ]


def test_bad_status_and_outcome(store):
    with pytest.raises(JobsError):
        store.set_status("platform_a", "quiet")
    with pytest.raises(JobsError):
        store.record_check("platform_a", "maybe")


def test_unknown_platform(store):
    with pytest.raises(JobsNotFound):
        store.set_status("nope", "active")
    with pytest.raises(JobsNotFound):
        store.record_check("nope", "nothing")
    with pytest.raises(JobsNotFound):
        store.set_profile("nope", resume_label="v1")
    with pytest.raises(JobsNotFound):
        store.add_project(
            platform_id="nope", title="X", pay_cents=None, currency=None, hours_per_week=None
        )


# --- Profiles ---------------------------------------------------------------------------


def test_set_profile_partial_update_keeps_other_fields(store):
    store.set_profile(
        "platform_a",
        pay_low_cents=3000,
        pay_high_cents=5000,
        pay_currency="USD",
        resume_label="v2",
        domains=["python", "mechanical engineering"],
        assessments=["Physics test"],
        profile_updated_on="2026-11-20",
    )
    after = store.set_profile("platform_a", resume_label="v1")
    assert after.resume_label == "v1"
    assert (after.pay_low_cents, after.pay_high_cents, after.pay_currency) == (3000, 5000, "USD")
    assert after.domains == ["python", "mechanical engineering"]
    assert after.assessments == ["Physics test"]
    assert after.profile_updated_on == "2026-11-20"


@pytest.mark.parametrize(
    "fields",
    [
        {"pay_low_cents": 5000, "pay_high_cents": 3000, "pay_currency": "USD"},
        {"pay_low_cents": 3000},  # no currency
        {"pay_currency": "EUR", "pay_low_cents": 3000},
        {"resume_label": "x" * 41},
        {"domains": ["x" * 41]},
        {"domains": ["d"] * 21},
        {"profile_updated_on": "yesterday"},
        {"colour": "blue"},
    ],
)
def test_bad_profile_fields(store, fields):
    with pytest.raises(JobsError):
        store.set_profile("platform_a", **fields)


def test_refresh_rules(store, clock):
    # Applied or later with no profile date yet: refresh due. Not applied: never.
    assert card(store, "platform_a").refresh_due is True
    assert card(store, "platform_c").refresh_due is False
    store.set_profile("platform_a", resume_label="v2", profile_updated_on="2026-11-29")
    assert card(store, "platform_a").refresh_due is False
    clock.now += timedelta(days=89)
    assert card(store, "platform_a").refresh_due is False
    clock.now += timedelta(days=1)
    assert card(store, "platform_a").refresh_due is True  # 90 days old


def test_refresh_when_resume_label_differs_from_master(store):
    store.set_profile("platform_a", resume_label="v1", profile_updated_on="2026-11-29")
    assert card(store, "platform_a").refresh_due is True


def test_reading_writes_nothing(store, conn):
    before = conn.total_changes
    store.platforms()
    store.due()
    store.projects()
    store.active_platform_names()
    assert conn.total_changes == before


# --- Opportunity log --------------------------------------------------------------------


def add(store, **overrides):
    fields = {
        "platform_id": "platform_a",
        "title": "Physics reasoning reviews",
        "pay_cents": 4500,
        "currency": "USD",
        "hours_per_week": 10,
    }
    fields.update(overrides)
    return store.add_project(**fields)


def test_add_project(store):
    p = add(store)
    assert (p.status, p.found_on, p.platform_name) == ("found", "2026-11-29", "Platform A")
    assert (p.pay_usd_cents, p.pay_cad_cents, p.flags) == (4500, None, [])


@pytest.mark.parametrize(
    "fields",
    [
        {"title": "  "},
        {"title": "x" * 81},
        {"pay_cents": 4500, "currency": None},
        {"pay_cents": None, "currency": "USD"},
        {"currency": "EUR"},
        {"pay_cents": -1},
        {"hours_per_week": 0},
        {"hours_per_week": 81},
    ],
)
def test_bad_project_fields(store, fields):
    with pytest.raises(JobsError):
        add(store, **fields)


def test_below_floor_flag(store):
    assert add(store, pay_cents=2500).flags == ["below_floor"]


def test_cad_pay_converts_at_the_rate(conn, clock):
    store = JobsStore(conn, SETTINGS, clock=clock, usd_rate=Decimal("1.40"))
    p = add(store, pay_cents=4500, currency="CAD")
    assert (p.pay_usd_cents, p.pay_cad_cents, p.flags) == (3214, 4500, [])
    usd = add(store, pay_cents=4000, currency="USD")
    assert (usd.pay_usd_cents, usd.pay_cad_cents) == (4000, 5600)


def test_cad_pay_without_a_rate_has_no_usd_and_no_flag(store):
    p = add(store, pay_cents=2000, currency="CAD")
    assert (p.pay_usd_cents, p.pay_cad_cents, p.flags) == (None, 2000, [])


def test_project_moves(store):
    p = add(store)
    assert store.set_project_status(p.id, "applied").status == "applied"
    assert store.set_project_status(p.id, "accepted").status == "accepted"  # skips assessment
    assert store.set_project_status(p.id, "active").status == "active"
    assert store.set_project_status(p.id, "ended").status == "ended"
    with pytest.raises(JobsConflict):
        store.set_project_status(p.id, "active")  # ended is final


def test_rejected_from_accepted_and_final(store):
    p = add(store)
    store.set_project_status(p.id, "accepted")
    assert store.set_project_status(p.id, "rejected").status == "rejected"
    with pytest.raises(JobsConflict):
        store.set_project_status(p.id, "applied")


@pytest.mark.parametrize(("start", "target"), [("active", "found"), ("active", "rejected")])
def test_illegal_moves(store, start, target):
    p = add(store)
    store.set_project_status(p.id, start)
    with pytest.raises(JobsConflict):
        store.set_project_status(p.id, target)


def test_unknown_project_and_status(store):
    with pytest.raises(JobsNotFound):
        store.set_project_status(999, "applied")
    p = add(store)
    with pytest.raises(JobsError):
        store.set_project_status(p.id, "interview")


def test_edit_project(store):
    p = add(store)
    after = store.edit_project(p.id, title="Chemistry reviews", hours_per_week=5)
    assert (after.title, after.hours_per_week, after.pay_cents) == ("Chemistry reviews", 5, 4500)
    cleared = store.edit_project(p.id, pay_cents=None, currency=None)
    assert (cleared.pay_cents, cleared.currency) == (None, None)
    with pytest.raises(JobsError):
        store.edit_project(p.id, status="active")


def test_project_order_open_first_then_finished(store):
    add(store, title="One")
    active = add(store, title="Two")
    store.set_project_status(active.id, "active")
    ended = add(store, title="Three")
    store.set_project_status(ended.id, "ended")
    add(store, title="Four")
    # Open ones in status order (found before active), newest first; then finished.
    assert [p.title for p in store.projects()] == ["Four", "One", "Two", "Three"]


def test_active_platform_names(store):
    p = add(store, platform_id="platform_b")
    assert store.active_platform_names() == []
    store.set_project_status(p.id, "active")
    add(store, platform_id="platform_b")  # a second, not active
    assert store.active_platform_names() == ["Platform B"]


def test_project_on_a_removed_platform_shows_its_id(conn, clock):
    JobsStore(conn, SETTINGS, clock=clock).add_project(
        platform_id="platform_c", title="X", pay_cents=None, currency=None, hours_per_week=None
    )
    [p] = JobsStore(conn, fewer_platforms(), clock=clock).projects()
    assert p.platform_name == "platform_c"
