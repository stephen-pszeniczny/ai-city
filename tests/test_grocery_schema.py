"""Tests for migration 013: the grocery_items table.

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


def add(conn, **overrides) -> int:
    row = {
        "name": "Eggs",
        "status": "open",
        "created_at": STAMP,
        "ticked_at": None,
        "cleared_at": None,
    }
    row.update(overrides)
    cols = ", ".join(row)
    marks = ", ".join("?" for _ in row)
    return conn.execute(
        f"INSERT INTO grocery_items ({cols}) VALUES ({marks})", tuple(row.values())
    ).lastrowid


def test_good_rows(conn):
    add(conn)
    add(conn, status="ticked", ticked_at=STAMP)
    add(conn, status="cleared", cleared_at=STAMP)
    assert conn.execute("SELECT count(*) FROM grocery_items").fetchone() == (3,)


@pytest.mark.parametrize(
    "overrides",
    [
        {"name": ""},
        {"name": " Eggs"},
        {"name": "x" * 101},
        {"status": "bought"},
        {"status": "ticked"},
        {"ticked_at": STAMP},
        {"status": "cleared"},
        {"cleared_at": STAMP},
        {"status": "cleared", "cleared_at": STAMP, "ticked_at": STAMP},
        {"created_at": "today"},
    ],
)
def test_bad_rows_are_refused(conn, overrides):
    with pytest.raises(sqlite3.IntegrityError):
        add(conn, **overrides)


def test_items_are_never_deleted(conn):
    item = add(conn)
    with pytest.raises(sqlite3.IntegrityError, match="never deleted"):
        conn.execute("DELETE FROM grocery_items WHERE id = ?", (item,))
