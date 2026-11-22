"""Tests for migration 015: the Opportunity Office platform tracker tables.

These check the rules the database itself enforces. Every database here is temporary.
"""

import sqlite3

import pytest

from aicity.db import DbKind, load_migrations, migrate, open_database

STAMP = "2026-11-29T15:00:00Z"


@pytest.fixture
def conn(tmp_path):
    c = open_database(tmp_path / "sample.db", DbKind.SAMPLE)
    yield c
    c.close()


def insert(conn, table: str, row: dict) -> int:
    cols = ", ".join(row)
    marks = ", ".join("?" for _ in row)
    return conn.execute(
        f"INSERT INTO {table} ({cols}) VALUES ({marks})", tuple(row.values())
    ).lastrowid


def project(**overrides) -> dict:
    row = {
        "platform_id": "platform_a",
        "title": "Physics reasoning reviews",
        "pay_cents": 4500,
        "currency": "USD",
        "hours_per_week": 10,
        "status": "found",
        "found_on": "2026-11-29",
        "status_at": STAMP,
    }
    row.update(overrides)
    return row


def profile(**overrides) -> dict:
    row = {
        "platform_id": "platform_a",
        "pay_low_cents": 3000,
        "pay_high_cents": 5000,
        "pay_currency": "USD",
        "resume_label": "v1",
        "domains_json": '["python"]',
        "assessments_json": '["Physics test"]',
        "profile_updated_on": "2026-11-01",
        "updated_at": STAMP,
    }
    row.update(overrides)
    return row


def test_good_rows(conn):
    insert(
        conn,
        "platform_status_events",
        {"platform_id": "platform_a", "status": "onboarding", "changed_at": STAMP},
    )
    insert(
        conn,
        "platform_checks",
        {"platform_id": "platform_a", "outcome": "nothing", "checked_at": STAMP},
    )
    insert(conn, "platform_profiles", profile())
    insert(conn, "job_projects", project())
    insert(conn, "job_projects", project(pay_cents=None, currency=None, hours_per_week=None))
    insert(conn, "job_projects", project(status="ended"))


@pytest.mark.parametrize(
    ("table", "row"),
    [
        ("platform_status_events", {"platform_id": "a", "status": "quiet", "changed_at": STAMP}),
        ("platform_checks", {"platform_id": "a", "outcome": "maybe", "checked_at": STAMP}),
        ("platform_checks", {"platform_id": "a", "outcome": "found", "checked_at": "today"}),
        ("job_projects", project(status="interview")),
        ("job_projects", project(currency=None)),
        ("job_projects", project(pay_cents=None)),
        ("job_projects", project(currency="EUR")),
        ("job_projects", project(title="x" * 81)),
        ("job_projects", project(title=" padded ")),
        ("job_projects", project(title="")),
        ("job_projects", project(hours_per_week=0)),
        ("job_projects", project(found_on="29/11/2026")),
        ("platform_profiles", profile(domains_json="not json")),
        ("platform_profiles", profile(pay_low_cents=6000)),
        ("platform_profiles", profile(pay_currency=None)),
        ("platform_profiles", profile(resume_label="x" * 41)),
    ],
)
def test_bad_rows_refused(conn, table, row):
    with pytest.raises(sqlite3.IntegrityError):
        insert(conn, table, row)


@pytest.mark.parametrize(
    ("table", "row"),
    [
        ("platform_status_events", {"platform_id": "a", "status": "active", "changed_at": STAMP}),
        ("platform_checks", {"platform_id": "a", "outcome": "found", "checked_at": STAMP}),
        ("platform_profiles", profile()),
        ("job_projects", project()),
    ],
)
def test_rows_are_never_deleted(conn, table, row):
    insert(conn, table, row)
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(f"DELETE FROM {table}")


def test_old_tables_are_gone(conn):
    names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert {"job_leads", "job_lead_scores", "job_scan_runs", "job_platform_events"}.isdisjoint(
        names
    )


def test_old_platform_stages_are_carried_over(tmp_path):
    c = open_database(tmp_path / "sample.db", DbKind.SAMPLE, load_migrations()[:14])
    for platform_id, stage in [("a", "not_joined"), ("b", "quiet"), ("c", "assessment")]:
        c.execute(
            "INSERT INTO job_platform_events (platform_id, stage, changed_at) VALUES (?, ?, ?)",
            (platform_id, stage, STAMP),
        )
    migrate(c, load_migrations()[:15])
    rows = c.execute(
        "SELECT platform_id, status, changed_at FROM platform_status_events ORDER BY id"
    ).fetchall()
    assert rows == [("a", "not_applied", STAMP), ("b", "paused", STAMP), ("c", "assessment", STAMP)]
    c.close()
