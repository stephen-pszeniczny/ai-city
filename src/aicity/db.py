"""Opening, creating and updating the app's database files.

There are two database files, both in <data folder>/db/:
    personal.db  real information
    sample.db    generated fictional data for screenshots and demos

Each file carries a label (meta.db_kind) saying which one it is. Opening a
file with the wrong label, or with no label, is refused. That label check is
what keeps real and sample data from ever mixing.

Migrations are numbered SQL files in src/aicity/migrations/ (001_meta.sql,
002_tasks.sql, ...). Each database remembers how many it has had, in
SQLite's built-in user_version counter, and only new ones are applied.
Each migration runs inside a transaction: it fully applies or not at all.
"""

import os
import re
import sqlite3
import tempfile
import time
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path

from aicity import config

MIGRATIONS_DIR = Path(__file__).resolve().parent / "migrations"
_MIGRATION_NAME = re.compile(r"(\d{3})_[a-z0-9_]+\.sql")


class DbKind(StrEnum):
    PERSONAL = "personal"
    SAMPLE = "sample"


class DatabaseError(Exception):
    """A database file can't be used safely. The message says why."""


@dataclass(frozen=True)
class Migration:
    number: int
    name: str
    sql: str


# --- Where the files live --------------------------------------------------


def db_path(kind: DbKind) -> Path:
    return config.data_dir() / "db" / f"{DbKind(kind).value}.db"


# --- Opening ---------------------------------------------------------------


def open_database(
    path: Path, kind: DbKind, migrations: list[Migration] | None = None
) -> sqlite3.Connection:
    """Open the database at path, checking it's labelled `kind`.

    If the file doesn't exist yet, it's created, fully migrated and labelled
    first. Existing files are label-checked BEFORE anything is changed, then
    brought up to date with any new migrations.
    """
    kind = DbKind(kind)
    migrations = load_migrations() if migrations is None else migrations

    if not path.exists():
        _create(path, kind, migrations)

    conn = _connect(path)
    try:
        _check_label(conn, kind)
        migrate(conn, migrations)
    except BaseException:
        conn.close()
        raise
    return conn


def _create(path: Path, kind: DbKind, migrations: list[Migration]) -> None:
    """Build a new, labelled database under a temporary name, then move it into place.

    Safe if two programs create the same database at the same moment: each
    builds its own uniquely named temporary file, and moving it into place
    only succeeds if no database is there yet (os.link never overwrites).
    The program that loses the race throws its copy away and uses the winner's.
    """
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    _clear_stale_temp_files(path)
    fd, temp_name = tempfile.mkstemp(dir=path.parent, prefix=_temp_prefix(path))
    os.close(fd)  # mkstemp makes the file owner-only (0600); SQLite fills it in
    temp = Path(temp_name)
    try:
        conn = _connect(temp)
        try:
            migrate(conn, migrations)
            with_transaction(
                conn,
                lambda: conn.execute(
                    "INSERT INTO meta (key, value) VALUES ('db_kind', ?)", (kind.value,)
                ),
            )
        finally:
            conn.close()
        try:
            os.link(temp, path)
        except FileExistsError:
            pass  # another program finished first; its database is used instead
    finally:
        temp.unlink(missing_ok=True)


STALE_TEMP_SECONDS = 3600


def _temp_prefix(path: Path) -> str:
    return f".{path.name}.creating-"


def _clear_stale_temp_files(path: Path) -> None:
    """Remove half-built files left by a crash. Recent ones may belong to a running program."""
    cutoff = time.time() - STALE_TEMP_SECONDS
    for leftover in path.parent.glob(_temp_prefix(path) + "*"):
        try:
            if leftover.stat().st_mtime < cutoff:
                leftover.unlink()
        except FileNotFoundError:
            pass


def _connect(path: Path) -> sqlite3.Connection:
    # autocommit=True: Python adds no hidden transactions; we control them.
    conn = sqlite3.connect(path, autocommit=True)
    conn.set_authorizer(_block_attach)
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def _block_attach(action: int, *_args) -> int:
    """Refuse ATTACH: it's the one way one database file could reach into another."""
    if action in (sqlite3.SQLITE_ATTACH, sqlite3.SQLITE_DETACH):
        return sqlite3.SQLITE_DENY
    return sqlite3.SQLITE_OK


def _check_label(conn: sqlite3.Connection, expected: DbKind) -> None:
    try:
        row = conn.execute("SELECT value FROM meta WHERE key = 'db_kind'").fetchone()
    except sqlite3.DatabaseError:
        # No meta table, or not a database file at all.
        raise DatabaseError(
            f"Refusing to open: this file isn't a labelled AI City database "
            f"(expected the {expected.value} database)."
        ) from None
    if row is None:
        raise DatabaseError(
            f"Refusing to open: this database has no label "
            f"(expected the {expected.value} database)."
        )
    if row[0] != expected.value:
        raise DatabaseError(
            f"Refusing to open: this is the {row[0]} database, "
            f"but the {expected.value} database was expected."
        )


# --- Migrations ------------------------------------------------------------


def load_migrations(directory: Path = MIGRATIONS_DIR) -> list[Migration]:
    """Read migration files, checking they're numbered 001, 002, ... with no gaps."""
    found: list[Migration] = []
    for f in sorted(directory.iterdir()):
        if f.suffix != ".sql":
            continue
        m = _MIGRATION_NAME.fullmatch(f.name)
        if not m:
            raise DatabaseError(f"Badly named migration file: {f.name} (expected 001_name.sql).")
        migration = Migration(int(m[1]), f.name, f.read_text(encoding="utf-8"))
        _check_no_transaction_control(migration)
        found.append(migration)

    for expected, migration in enumerate(found, start=1):
        if migration.number != expected:
            raise DatabaseError(
                f"Migrations must be numbered 001, 002, ... with no gaps or repeats; "
                f"found {migration.name} where number {expected:03d} was expected."
            )
    return found


def schema_version(conn: sqlite3.Connection) -> int:
    return conn.execute("PRAGMA user_version").fetchone()[0]


def migrate(conn: sqlite3.Connection, migrations: list[Migration]) -> int:
    """Apply migrations the database hasn't had yet. Returns how many were applied.

    Safe if two programs update the same database at once: each step takes
    the write lock first (BEGIN IMMEDIATE) and only then checks the version,
    so the second program waits, sees the work is done, and does nothing.
    """
    applied = 0
    while True:
        conn.execute("BEGIN IMMEDIATE")
        try:
            current = schema_version(conn)
            if current > len(migrations):
                raise DatabaseError(
                    f"This database was updated by a newer version of the app "
                    f"(schema {current}, this version knows {len(migrations)}). Refusing to open."
                )
            if current == len(migrations):
                conn.execute("COMMIT")
                return applied
            _apply(conn, migrations[current])
            conn.execute("COMMIT")
            applied += 1
        except BaseException:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise


def _apply(conn: sqlite3.Connection, migration: Migration) -> None:
    """Run one migration inside the caller's open transaction."""
    _check_no_transaction_control(migration)
    script = f"{migration.sql}\n;\nPRAGMA user_version = {migration.number};"
    try:
        conn.executescript(script)
    except sqlite3.Error as exc:
        raise DatabaseError(f"Migration {migration.name} failed and was undone: {exc}") from None


_TRANSACTION_WORDS = {"BEGIN", "COMMIT", "END", "ROLLBACK", "SAVEPOINT", "RELEASE"}
_LEADING_COMMENTS = re.compile(r"\A(?:\s+|--[^\n]*(?:\n|\Z)|/\*.*?\*/)*", re.DOTALL)


def _check_no_transaction_control(migration: Migration) -> None:
    """Refuse migrations that start or end transactions themselves.

    That would end the protective transaction early and break all-or-nothing.
    Statements are split the way SQLite reads them, so a trigger's own
    BEGIN ... END body is allowed.
    """
    for statement in _statements(migration.sql):
        body = _LEADING_COMMENTS.sub("", statement)
        first_word = re.match(r"[A-Za-z]*", body)[0].upper()
        if first_word in _TRANSACTION_WORDS:
            raise DatabaseError(
                f"Migration {migration.name} contains {first_word}. Migrations must not "
                f"control transactions; the app wraps each one in its own."
            )


def _statements(sql: str) -> list[str]:
    """Split SQL into complete statements (handles strings, comments and triggers)."""
    statements, buffer = [], ""
    parts = sql.split(";")
    for i, part in enumerate(parts):
        buffer += part
        if i < len(parts) - 1:  # a real ';' followed this part
            buffer += ";"
            if sqlite3.complete_statement(buffer):  # not inside a string, comment or trigger
                statements.append(buffer)
                buffer = ""
    if buffer.strip():
        statements.append(buffer)
    return statements


def with_transaction(conn: sqlite3.Connection, work):
    """Run work() inside a transaction: all of it is saved, or none of it."""
    conn.execute("BEGIN")
    try:
        result = work()
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    conn.execute("COMMIT")
    return result
