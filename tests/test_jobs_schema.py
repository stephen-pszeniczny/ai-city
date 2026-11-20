"""Tests for migration 014: Opportunity Office tables.

These check the rules the database itself enforces. Every database here is temporary.
"""

import sqlite3

import pytest

from aicity.db import DbKind, open_database

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


def lead(conn, **overrides) -> int:
    row = {
        "origin": "pasted",
        "external_id": None,
        "url": "https://example.com/job/1",
        "title": "AI trainer",
        "company": "Nimbus Data",
        "remote": "yes",
        "canada_ok": "unknown",
        "job_type": "contract",
        "pay_low": 4000,
        "pay_high": 6000,
        "pay_currency": "USD",
        "pay_unit": "hour",
        "first_seen": STAMP,
        "last_seen": STAMP,
        "status": "new",
        "status_at": STAMP,
    }
    row.update(overrides)
    return insert(conn, "job_leads", row)


def run(conn) -> int:
    return insert(conn, "job_scan_runs", {"started_at": STAMP})


def test_good_rows(conn):
    batch = run(conn)
    first = lead(conn)
    lead(
        conn,
        origin="company_a",
        external_id="123",
        batch_id=batch,
        batch_rank=1,
        status="applied",
        applied_at=STAMP,
        resume_label="v3 Nov 2026",
    )
    lead(conn, url="https://example.com/job/2", merged_into=first, pay_low=None, pay_high=None)
    insert(
        conn,
        "job_lead_scores",
        {
            "lead_id": first,
            "profile_id": "ai_training",
            "score": 82,
            "verdict": "strong",
            "matched_json": '["python"]',
            "gaps_json": "[]",
            "flags_json": "[]",
            "scored_at": STAMP,
        },
    )
    insert(
        conn,
        "job_platform_events",
        {"platform_id": "platform_a", "stage": "assessment", "changed_at": STAMP},
    )
    assert conn.execute("SELECT count(*) FROM job_leads").fetchone()[0] == 3


@pytest.mark.parametrize(
    "overrides",
    [
        {"status": "hired"},
        {"status": "applied"},  # no applied_at
        {"applied_at": STAMP},  # no label
        {"external_id": "abc"},  # pasted lead with an external id
        {"origin": "company_a"},  # scanned lead without one
        {"pay_low": 7000, "pay_high": 6000},
        {"pay_low": -1},
        {"url": "http://example.com/job"},
        {"title": " AI trainer"},
        {"remote": "maybe"},
        {"job_type": "gig"},
        {"pay_currency": "GBP"},
        {"first_seen": "2026-11-29 15:00"},
    ],
)
def test_bad_leads_refused(conn, overrides):
    with pytest.raises(sqlite3.IntegrityError):
        lead(conn, **overrides)


def test_duplicate_scanned_lead_refused(conn):
    lead(conn, origin="company_a", external_id="1")
    with pytest.raises(sqlite3.IntegrityError):
        lead(conn, origin="company_a", external_id="1")


def test_bad_score_and_stage_refused(conn):
    first = lead(conn)
    score = {
        "lead_id": first,
        "profile_id": "ai_training",
        "score": 50,
        "verdict": "maybe",
        "matched_json": "not json",
        "gaps_json": "[]",
        "flags_json": "[]",
        "scored_at": STAMP,
    }
    with pytest.raises(sqlite3.IntegrityError):
        insert(conn, "job_lead_scores", score)
    with pytest.raises(sqlite3.IntegrityError):
        insert(conn, "job_lead_scores", {**score, "matched_json": "[]", "score": 101})
    with pytest.raises(sqlite3.IntegrityError):
        insert(
            conn,
            "job_platform_events",
            {"platform_id": "platform_a", "stage": "hired", "changed_at": STAMP},
        )


def test_rows_are_never_deleted(conn):
    first = lead(conn)
    run(conn)
    insert(
        conn,
        "job_platform_events",
        {"platform_id": "platform_a", "stage": "active", "changed_at": STAMP},
    )
    for table in ("job_leads", "job_scan_runs", "job_platform_events"):
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(f"DELETE FROM {table}")
    assert conn.execute("SELECT id FROM job_leads").fetchone()[0] == first
