"""Tests for migration 016: Flight School tables (rules the database enforces)."""

import sqlite3

import pytest

from aicity.db import DbKind, open_database

STAMP = "2026-11-29T15:00:00Z"


@pytest.fixture
def conn(tmp_path):
    c = open_database(tmp_path / "sample.db", DbKind.SAMPLE)
    c.execute(
        "INSERT INTO fs_months (month, status, updated_at) VALUES ('2026-11', 'draft', ?)",
        (STAMP,),
    )
    c.execute(
        "INSERT INTO fs_skills (name, category, level, created_at) VALUES ('Python', 1, 3, ?)",
        (STAMP,),
    )
    yield c
    c.close()


def insert(conn, table: str, row: dict) -> int:
    cols = ", ".join(row)
    marks = ", ".join("?" for _ in row)
    return conn.execute(
        f"INSERT INTO {table} ({cols}) VALUES ({marks})", tuple(row.values())
    ).lastrowid


GOOD = {
    "fs_proposals": {
        "month": "2026-11",
        "kind": "bullet",
        "payload_json": "{}",
        "status": "pending",
        "created_at": STAMP,
    },
    "fs_bullets": {"month": "2026-11", "text": "Reviewed a design", "links_json": "{}"},
    "fs_examples": {
        "competency_id": "2.1",
        "month": "2026-11",
        "situation": "S",
        "action": "A",
        "outcome": "O",
        "status": "ready",
        "updated_at": STAMP,
    },
    "fs_skill_links": {"skill_id": 1, "competency_id": "1.4", "strength": 0.5},
    "fs_level_events": {"skill_id": 1, "to_level": 3, "evidence": "", "at": STAMP},
    "fs_recommendations": {
        "skill_id": 1,
        "kind": "course",
        "title": "Course",
        "provider": "",
        "url": "https://example.com",
        "price": "",
        "free": 1,
        "status": "open",
        "created_at": STAMP,
    },
    "fs_study": {"day": "2026-11-29", "minutes": 30, "created_at": STAMP},
    "fs_study_target": {"minutes_per_week": 0, "changed_at": STAMP},
    "fs_progress": {
        "month": "2026-11",
        "competencies_ready": 3,
        "competencies_new": 1,
        "level_changes_json": "[]",
        "study_minutes": 0,
        "made_at": STAMP,
    },
}


@pytest.mark.parametrize("table", list(GOOD))
def test_good_rows(conn, table):
    insert(conn, table, GOOD[table])


@pytest.mark.parametrize(
    ("table", "change"),
    [
        ("fs_skills", {"name": "Excel", "category": 1, "level": 6, "created_at": STAMP}),
        ("fs_skills", {"name": "python", "category": 1, "level": 2, "created_at": STAMP}),
        ("fs_skills", {"name": "Excel", "category": 8, "level": 2, "created_at": STAMP}),
        ("fs_months", {"month": "Nov 2026", "status": "draft", "updated_at": STAMP}),
        ("fs_proposals", {**GOOD["fs_proposals"], "decided_at": STAMP}),
        ("fs_proposals", {**GOOD["fs_proposals"], "status": "accepted"}),
        ("fs_proposals", {**GOOD["fs_proposals"], "kind": "poem"}),
        ("fs_proposals", {**GOOD["fs_proposals"], "payload_json": "not json"}),
        ("fs_skill_links", {"skill_id": 1, "strength": 0.5}),
        (
            "fs_skill_links",
            {"skill_id": 1, "other_skill_id": 1, "competency_id": "1.4", "strength": 0.5},
        ),
        ("fs_recommendations", {**GOOD["fs_recommendations"], "url": "http://example.com"}),
        ("fs_study", {**GOOD["fs_study"], "minutes": 0}),
        ("fs_bullets", {**GOOD["fs_bullets"], "text": "x" * 301}),
    ],
)
def test_bad_rows_refused(conn, table, change):
    with pytest.raises(sqlite3.IntegrityError):
        insert(conn, table, change)


@pytest.mark.parametrize("table", ["fs_months", "fs_skills", *GOOD])
def test_rows_are_never_deleted(conn, table):
    if table in GOOD:
        insert(conn, table, GOOD[table])
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(f"DELETE FROM {table}")
