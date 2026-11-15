"""Tests for creating, labelling, opening and migrating database files.

Every database here is a temporary file. The real databases are never used.
"""

import sqlite3
import stat

import pytest

from aicity import config
from aicity.db import (
    DatabaseError,
    DbKind,
    Migration,
    db_path,
    load_migrations,
    migrate,
    open_database,
    schema_version,
)

META = load_migrations()[0]
TASKS_V2 = Migration(2, "002_things.sql", "CREATE TABLE things (id INTEGER PRIMARY KEY) STRICT;")


def label_of(path) -> str:
    conn = sqlite3.connect(path)
    try:
        return conn.execute("SELECT value FROM meta WHERE key='db_kind'").fetchone()[0]
    finally:
        conn.close()


def tables_in(conn) -> set[str]:
    rows = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    return {r[0] for r in rows}


# --- Where files live ------------------------------------------------------


def test_files_live_in_data_folder_db_subfolder(monkeypatch, tmp_path):
    monkeypatch.setenv(config.DATA_DIR_ENV, str(tmp_path))
    assert db_path(DbKind.PERSONAL) == tmp_path.resolve() / "db" / "personal.db"
    assert db_path(DbKind.SAMPLE) == tmp_path.resolve() / "db" / "sample.db"


def test_only_two_kinds_exist():
    assert {k.value for k in DbKind} == {"personal", "sample"}
    with pytest.raises(ValueError):
        db_path("other")


# --- Creating --------------------------------------------------------------


@pytest.mark.parametrize("kind", list(DbKind))
def test_new_database_is_created_labelled_and_migrated(tmp_path, kind):
    path = tmp_path / "db" / f"{kind}.db"
    conn = open_database(path, kind)
    try:
        assert label_of(path) == kind.value
        assert schema_version(conn) == len(load_migrations())
        assert "meta" in tables_in(conn)
    finally:
        conn.close()


def test_new_database_is_private_to_this_account(tmp_path):
    path = tmp_path / "db" / "personal.db"
    open_database(path, DbKind.PERSONAL).close()
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert stat.S_IMODE(path.parent.stat().st_mode) == 0o700


def test_failed_creation_leaves_no_file_behind(tmp_path):
    path = tmp_path / "personal.db"
    bad = [META, Migration(2, "002_bad.sql", "CREATE TABLE oops (;")]
    with pytest.raises(DatabaseError, match="002_bad.sql"):
        open_database(path, DbKind.PERSONAL, bad)
    assert list(tmp_path.iterdir()) == []


def test_leftover_from_earlier_crash_is_cleared(tmp_path):
    path = tmp_path / "personal.db"
    (tmp_path / ".personal.db.creating").write_bytes(b"half-built junk")
    open_database(path, DbKind.PERSONAL).close()
    assert label_of(path) == "personal"
    assert not (tmp_path / ".personal.db.creating").exists()


# --- Opening existing files: the label check -------------------------------


def test_reopening_same_kind_works(tmp_path):
    path = tmp_path / "personal.db"
    open_database(path, DbKind.PERSONAL).close()
    open_database(path, DbKind.PERSONAL).close()
    assert label_of(path) == "personal"


@pytest.mark.parametrize(
    ("created", "requested"),
    [(DbKind.PERSONAL, DbKind.SAMPLE), (DbKind.SAMPLE, DbKind.PERSONAL)],
)
def test_wrong_label_is_refused_and_file_untouched(tmp_path, created, requested):
    path = tmp_path / "x.db"
    open_database(path, created, [META]).close()
    before = path.read_bytes()

    with pytest.raises(DatabaseError, match="Refusing to open"):
        open_database(path, requested, [META, TASKS_V2])  # would add a table if allowed

    assert path.read_bytes() == before  # not even migrated
    assert label_of(path) == created.value


def test_unlabelled_database_is_refused(tmp_path):
    path = tmp_path / "personal.db"
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    conn.commit()
    conn.close()
    with pytest.raises(DatabaseError, match="no label"):
        open_database(path, DbKind.PERSONAL)


def test_unrelated_database_is_refused(tmp_path):
    path = tmp_path / "personal.db"
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE something_else (x)")
    conn.commit()
    conn.close()
    with pytest.raises(DatabaseError, match="isn't a labelled AI City database"):
        open_database(path, DbKind.PERSONAL)


def test_file_that_is_not_a_database_is_refused(tmp_path):
    path = tmp_path / "personal.db"
    path.write_bytes(b"this is just some text, not a database " * 50)
    before = path.read_bytes()
    with pytest.raises(DatabaseError, match="Refusing to open"):
        open_database(path, DbKind.PERSONAL)
    assert path.read_bytes() == before


# --- Migrations ------------------------------------------------------------


def test_only_new_migrations_are_applied(tmp_path):
    path = tmp_path / "personal.db"
    open_database(path, DbKind.PERSONAL, [META]).close()

    conn = open_database(path, DbKind.PERSONAL, [META, TASKS_V2])
    try:
        assert schema_version(conn) == 2
        assert "things" in tables_in(conn)
        assert migrate(conn, [META, TASKS_V2]) == 0  # nothing left to do
    finally:
        conn.close()


def test_data_survives_later_migrations(tmp_path):
    path = tmp_path / "personal.db"
    conn = open_database(path, DbKind.PERSONAL, [META])
    conn.execute("INSERT INTO meta VALUES ('note', 'keep me')")
    conn.close()

    conn = open_database(path, DbKind.PERSONAL, [META, TASKS_V2])
    try:
        assert conn.execute("SELECT value FROM meta WHERE key='note'").fetchone()[0] == "keep me"
    finally:
        conn.close()


def test_failed_migration_is_fully_undone(tmp_path):
    path = tmp_path / "personal.db"
    open_database(path, DbKind.PERSONAL, [META]).close()
    half_broken = Migration(
        2, "002_half.sql", "CREATE TABLE half_done (x INTEGER) STRICT;\nCREATE TABLE oops (;"
    )

    with pytest.raises(DatabaseError, match="002_half.sql"):
        open_database(path, DbKind.PERSONAL, [META, half_broken])

    conn = sqlite3.connect(path)
    try:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 1
        assert "half_done" not in tables_in(conn)  # first statement rolled back too
    finally:
        conn.close()


def test_database_from_newer_app_version_is_refused(tmp_path):
    path = tmp_path / "personal.db"
    open_database(path, DbKind.PERSONAL, [META, TASKS_V2]).close()
    with pytest.raises(DatabaseError, match="newer version"):
        open_database(path, DbKind.PERSONAL, [META])


def test_real_migration_files_are_numbered_correctly():
    migrations = load_migrations()
    assert [m.number for m in migrations] == list(range(1, len(migrations) + 1))
    assert migrations[0].name == "001_meta.sql"


@pytest.mark.parametrize(
    "names",
    [
        ["001_a.sql", "003_c.sql"],  # gap
        ["001_a.sql", "001_b.sql"],  # repeat
        ["002_b.sql"],  # doesn't start at 001
        ["001_a.sql", "2_b.sql"],  # badly named
        ["001_Has-Caps.sql"],  # badly named
    ],
)
def test_bad_migration_numbering_is_refused(tmp_path, names):
    for name in names:
        (tmp_path / name).write_text("SELECT 1;")
    with pytest.raises(DatabaseError):
        load_migrations(tmp_path)


def test_non_sql_files_in_migrations_folder_are_ignored(tmp_path):
    (tmp_path / "001_a.sql").write_text("SELECT 1;")
    (tmp_path / "README.md").write_text("notes")
    assert [m.name for m in load_migrations(tmp_path)] == ["001_a.sql"]


# --- Connection safety settings ---------------------------------------------


@pytest.fixture
def conn(tmp_path):
    c = open_database(tmp_path / "personal.db", DbKind.PERSONAL)
    yield c
    c.close()


def test_attach_is_blocked(conn, tmp_path):
    other = tmp_path / "sample.db"
    open_database(other, DbKind.SAMPLE).close()
    with pytest.raises(sqlite3.DatabaseError, match="not authorized"):
        conn.execute("ATTACH DATABASE ? AS other", (str(other),))


def test_foreign_keys_are_enforced(conn):
    assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1


def test_meta_table_is_strict(conn):
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO meta VALUES ('k', NULL)")
