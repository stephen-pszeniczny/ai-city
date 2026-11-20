"""Opportunity Office store: pasted leads, the inbox, statuses and platform stages."""

from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from aicity.db import DbKind, open_database
from aicity.jobs_settings import JobPlatform, JobProfile, JobsSettings
from aicity.jobs_store import JobsConflict, JobsError, JobsNotFound, JobsStore

NOW = datetime(2026, 11, 29, 15, 0, tzinfo=UTC)

PROFILE = JobProfile(
    id="ai_training",
    name="AI training",
    active=True,
    pay_floor_usd=Decimal(30),
    pay_preferred_usd=Decimal(40),
    hours=(10, 15),
    job_types=("contract", "part_time"),
    title_words=("ai trainer",),
    exclude_words=("recruiter",),
    location_ok=("canada",),
    skills=("python", "technical writing"),
    gap_words=("sql",),
)
SETTINGS = JobsSettings(
    scan_day=6,
    scan_time=datetime(2026, 1, 1, 19).time(),
    top_n=2,
    follow_up_days=10,
    roll_off_days=90,
    profiles=(PROFILE,),
    sources=(),
    platforms=(
        JobPlatform("platform_a", "Platform A", "https://example.com/a", "active"),
        JobPlatform("platform_b", "Platform B", "https://example.com/b", "not_joined"),
        JobPlatform("platform_c", "Platform C", "https://example.com/c", "not_joined"),
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
    return JobsStore(conn, SETTINGS, clock=clock, usd_rate=Decimal("1.40"))


def paste(store, **overrides):
    values = {
        "url": "https://example.com/job/1",
        "title": "AI Trainer",
        "company": "Nimbus Data",
        "location": "Remote - Canada",
        "text": "Contract. $45/hr. Python and technical writing.",
        "profile_id": "ai_training",
    }
    values.update(overrides)
    return store.paste(**values)


def scanned(conn, batch: int, rank: int, title: str, status: str = "new") -> int:
    lead = conn.execute(
        "INSERT INTO job_leads (origin, external_id, title, company, remote, canada_ok,"
        " job_type, first_seen, last_seen, status, status_at, batch_id, batch_rank)"
        " VALUES ('company_a', ?, ?, 'Orbit Labs', 'yes', 'yes', 'contract', ?, ?, ?, ?, ?, ?)",
        (
            title,
            title,
            "2026-11-29T15:00:00Z",
            "2026-11-29T15:00:00Z",
            status,
            "2026-11-29T15:00:00Z",
            batch,
            rank,
        ),
    ).lastrowid
    conn.execute(
        "INSERT INTO job_lead_scores VALUES (?, 'ai_training', ?, 'maybe', '[]', '[]', '[]', ?)",
        (lead, 100 - rank, "2026-11-29T15:00:00Z"),
    )
    return lead


def batch(conn) -> int:
    return conn.execute(
        "INSERT INTO job_scan_runs (started_at, finished_at) VALUES (?, ?)",
        ("2026-11-29T15:00:00Z", "2026-11-29T15:01:00Z"),
    ).lastrowid


# --- Pasting ----------------------------------------------------------------


def test_paste_saves_and_scores(store):
    lead = paste(store)
    assert lead.status == "new"
    assert lead.pay_low_usd == 4500
    assert lead.canada_ok == "yes"
    assert lead.job_type == "contract"
    assert lead.matched == ["python", "technical writing"]
    assert lead.verdict == "strong"
    assert [x.id for x in store.list_leads("ai_training").new] == [lead.id]


def test_paste_below_floor_is_saved_with_its_reason(store):
    lead = paste(store, text="Contract. $20/hr.")
    assert lead.status == "new"
    assert "below_floor" in lead.flags


def test_cad_pay_shows_in_usd(store):
    assert paste(store, text="$56 CAD per hour").pay_low_usd == 4000


def test_pasting_same_role_twice_joins_first_by_url(store, conn):
    first = paste(store, location="", text="Python.")
    again = paste(store, title="Different words", company="Other", text="$45/hr contract")
    assert again.id == first.id
    assert again.title == "AI Trainer"  # filled fields are kept
    assert again.pay_low_usd == 4500  # empty pay was filled
    assert conn.execute("SELECT count(*) FROM job_leads").fetchone()[0] == 1


def test_pasting_same_role_twice_joins_first_by_company_and_title(store, conn):
    first = paste(store, url=None)
    again = paste(store, url="https://example.com/other", title="AI Trainer (Remote, Contract)")
    assert again.id == first.id
    assert again.url == "https://example.com/other"
    assert conn.execute("SELECT count(*) FROM job_leads").fetchone()[0] == 1


def test_same_title_after_30_days_is_a_new_lead(store, clock):
    first = paste(store, url=None)
    clock.now = NOW + timedelta(days=31)
    assert paste(store, url=None).id != first.id


@pytest.mark.parametrize(
    "overrides",
    [
        {"title": " "},
        {"company": ""},
        {"url": "http://example.com/job"},
        {"title": "x" * 201},
    ],
)
def test_paste_refuses_bad_input(store, overrides):
    with pytest.raises(JobsError):
        paste(store, **overrides)


def test_paste_with_unknown_profile(store):
    with pytest.raises(JobsNotFound):
        paste(store, profile_id="engineering")


# --- The inbox --------------------------------------------------------------


def test_new_earlier_and_more(store, conn):
    old = batch(conn)
    earlier = scanned(conn, old, 1, "Old role")
    latest = batch(conn)
    top1 = scanned(conn, latest, 1, "Role one")
    top2 = scanned(conn, latest, 2, "Role two")
    more = scanned(conn, latest, 3, "Role three")
    inbox = store.list_leads("ai_training")
    assert [x.id for x in inbox.new] == [top1, top2]
    assert [x.id for x in inbox.earlier] == [earlier]
    assert [x.id for x in inbox.more] == [more]


def test_list_leads_writes_nothing(store, conn):
    paste(store)
    before = conn.total_changes
    store.list_leads("ai_training")
    assert conn.total_changes == before


def test_statuses_sort_into_lists(store, conn):
    a = paste(store, url="https://example.com/a", title="Role a")
    b = paste(store, url="https://example.com/b", title="Role b")
    c = paste(store, url="https://example.com/c", title="Role c")
    store.set_status(a.id, "saved")
    store.set_status(b.id, "applied", "v3 Nov 2026")
    store.set_status(c.id, "skipped")
    inbox = store.list_leads("ai_training")
    assert [x.id for x in inbox.saved] == [a.id]
    assert [x.id for x in inbox.applied] == [b.id]
    assert [x.id for x in inbox.closed] == [c.id]
    assert inbox.new == []


def test_skip_rest_only_touches_new(store, conn):
    keep_saved = paste(store, url="https://example.com/a", title="Role a")
    store.set_status(keep_saved.id, "saved")
    applied = paste(store, url="https://example.com/b", title="Role b")
    store.set_status(applied.id, "applied", "v3")
    old = batch(conn)
    earlier = scanned(conn, old, 1, "Old role")
    batch(conn)
    fresh = paste(store, url="https://example.com/c", title="Role c")
    assert store.skip_rest("ai_training") == 1
    statuses = dict(conn.execute("SELECT id, status FROM job_leads").fetchall())
    assert statuses[fresh.id] == "skipped"
    assert statuses[keep_saved.id] == "saved"
    assert statuses[applied.id] == "applied"
    assert statuses[earlier] == "new"


def test_skip_rest_on_empty_list_is_zero(store):
    assert store.skip_rest("ai_training") == 0


def test_badge_counts(store):
    paste(store)
    assert store.badge_counts("ai_training") == {"new": 1}


# --- Statuses ---------------------------------------------------------------


def test_applying_needs_a_label(store):
    lead = paste(store)
    with pytest.raises(JobsError):
        store.set_status(lead.id, "applied")
    with pytest.raises(JobsError):
        store.set_status(lead.id, "applied", "x" * 41)


def test_applying_records_date_and_label(store):
    lead = store.set_status(paste(store).id, "applied", " v3 Nov 2026 ")
    assert lead.resume_label == "v3 Nov 2026"
    assert lead.applied_at == "2026-11-29T15:00:00Z"


@pytest.mark.parametrize(
    ("path", "ok"),
    [
        (["saved", "applied", "interview", "offer"], True),
        (["skipped", "new", "saved"], True),
        (["applied", "rejected"], True),
        (["applied", "new"], False),
        (["applied", "interview", "applied"], False),
        (["rejected"], False),
        (["applied", "offer", "rejected"], False),
    ],
)
def test_status_paths(store, path, ok):
    lead = paste(store)
    if ok:
        for status in path:
            store.set_status(lead.id, status, "v3" if status == "applied" else None)
    else:
        with pytest.raises(JobsConflict):
            for status in path:
                store.set_status(lead.id, status, "v3" if status == "applied" else None)


def test_unknown_status_and_lead(store):
    lead = paste(store)
    with pytest.raises(JobsError):
        store.set_status(lead.id, "hired")
    with pytest.raises(JobsNotFound):
        store.set_status(9999, "saved")


# --- Platforms --------------------------------------------------------------


def test_platforms_start_from_settings(store):
    stages = {p.id: p.stage for p in store.platforms()}
    assert stages == {
        "platform_a": "active",
        "platform_b": "not_joined",
        "platform_c": "not_joined",
    }


def test_platform_change_appends_one_event(store, conn):
    view = store.set_platform("platform_b", stage="applied", next_step="Wait for the test")
    assert (view.stage, view.next_step) == ("applied", "Wait for the test")
    view = store.set_platform("platform_b", stage="assessment")
    assert view.next_step == "Wait for the test"  # carried forward
    assert conn.execute("SELECT count(*) FROM job_platform_events").fetchone()[0] == 2


def test_platform_refuses(store):
    with pytest.raises(JobsNotFound):
        store.set_platform("platform_z", stage="active")
    with pytest.raises(JobsError):
        store.set_platform("platform_a", stage="hired")
    with pytest.raises(JobsError):
        store.set_platform("platform_a", next_step="x" * 101)


def test_nudges_oldest_first_at_most_two_and_snooze(store, clock):
    store.set_platform("platform_b", next_step="Apply")
    clock.now = NOW + timedelta(hours=1)
    store.set_platform("platform_c", next_step="Finish the test")
    clock.now = NOW + timedelta(hours=2)
    store.set_platform("platform_a", next_step="Update profile")
    assert [p.id for p in store.nudges()] == ["platform_b", "platform_c"]
    store.set_platform("platform_b", snooze=True)
    assert [p.id for p in store.nudges()] == ["platform_c", "platform_a"]
    clock.now = NOW + timedelta(days=29)
    assert "platform_b" in [p.id for p in store.nudges(limit=3)]


def test_platform_without_a_next_step_never_nudges(store):
    store.set_platform("platform_b", stage="applied")
    assert store.nudges() == []
