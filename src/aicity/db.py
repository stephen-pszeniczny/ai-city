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
    """Build a new, labelled database under a temporary name, then move it into place."""
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.creating")
    temp.unlink(missing_ok=True)  # leftover from an earlier crash
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
        os.chmod(temp, 0o600)  # readable by this Mac account only
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)


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
        found.append(Migration(int(m[1]), f.name, f.read_text(encoding="utf-8")))

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
    """Apply migrations the database hasn't had yet. Returns how many were applied."""
    current = schema_version(conn)
    if current > len(migrations):
        raise DatabaseError(
            f"This database was updated by a newer version of the app "
            f"(schema {current}, this version knows {len(migrations)}). Refusing to open."
        )
    pending = migrations[current:]
    for migration in pending:
        _apply(conn, migration)
    return len(pending)


def _apply(conn: sqlite3.Connection, migration: Migration) -> None:
    script = f"BEGIN;\n{migration.sql}\n;\nPRAGMA user_version = {migration.number};\nCOMMIT;"
    try:
        conn.executescript(script)
    except sqlite3.Error as exc:
        if conn.in_transaction:
            conn.execute("ROLLBACK")
        raise DatabaseError(f"Migration {migration.name} failed and was undone: {exc}") from None


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
