"""Tests for the Belt XP web routes (src/aicity/xp_routes.py).

Each test gets a temporary data folder with the example settings, which has no routines,
and a fake clock. The databases start empty, so in Sample mode a building's XP is just
its head start, plus whatever the test adds.
"""

import shutil
import sqlite3
import time
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from aicity import config, sample_data, xp_routes
from aicity.db import DatabaseError, DbKind, db_path, open_database
from aicity.main import create_app
from aicity.settings import BUILDING_IDS
from aicity.tasks import TaskStore
from aicity.xp_rules import EARNING_BUILDINGS, level_for_xp, xp_for_level

APP_URL = "http://127.0.0.1:8765"
EXAMPLE_SETTINGS = Path(__file__).resolve().parents[1] / "settings.example.toml"
NOW = datetime(2026, 11, 29, 15, 0, tzinfo=UTC)  # a Sunday
STAMP = "2026-11-29T15:00:00Z"
BUILDING_KEYS = {
    "id",
    "earning",
    "xp",
    "level",
    "level_start_xp",
    "next_level_xp",
    "tier",
    "seen_level",
    "celebrated_tier",
    "upgrade_waiting",
}
ROUTINE = """
[[routines]]
id = "private_prep"
title = "Private prep"
days = ["sun"]
shows_from = "19:00"
items = ["Alpha", "Beta"]
"""


@pytest.fixture
def app(tmp_path, monkeypatch):
    monkeypatch.setenv(config.DATA_DIR_ENV, str(tmp_path))
    (tmp_path / "settings").mkdir()
    shutil.copy(EXAMPLE_SETTINGS, tmp_path / "settings" / "settings.toml")
    app = create_app(dev=False)
    app.state.clock = lambda: NOW
    app.state.db_kind = DbKind.SAMPLE
    return app


@pytest.fixture
def client(app):
    return TestClient(app, base_url=APP_URL, headers={"origin": APP_URL})


def sql(kind: DbKind, statement: str, rows=((),)) -> list[tuple]:
    conn = open_database(db_path(kind), kind)
    try:
        if statement.startswith("SELECT"):
            return conn.execute(statement).fetchall()
        conn.executemany(statement, rows)
        return []
    finally:
        conn.close()


def add_gym_done(kind: DbKind, count: int) -> None:
    """`count` finished gym blocks (15 XP each), all in one made-up week."""
    sql(
        kind,
        "INSERT OR IGNORE INTO plan_weeks (id, week_start, created_at) VALUES (1, '2026-11-23', ?)",
        [(STAMP,)],
    )
    sql(
        kind,
        "INSERT INTO plan_blocks (week_id, day, start_time, end_time, title, kind, source, "
        "status, created_at, updated_at) "
        "VALUES (1, '2026-11-24', '12:00', '13:00', 'Gym', 'gym', 'added', 'done', ?, ?)",
        [(STAMP, STAMP)] * count,
    )


def get_xp(client) -> dict:
    response = client.get("/api/xp")
    assert response.status_code == 200, response.text
    return response.json()


def building(client, building_id: str) -> dict:
    return next(b for b in get_xp(client)["buildings"] if b["id"] == building_id)


def seen(client, key: str, level):
    return client.post("/api/xp/seen", json={"key": key, "level": level})


def celebrated(client, building_id: str, tier):
    return client.post(f"/api/xp/{building_id}/celebrated", json={"tier": tier})


def test_xp_shape_and_order(client):
    body = get_xp(client)
    assert set(body) == {"belt", "buildings"}
    assert set(body["belt"]) == {"level", "progress", "total_xp", "seen_level"}
    assert [b["id"] for b in body["buildings"]] == list(BUILDING_IDS)
    for b in body["buildings"]:
        assert set(b) == BUILDING_KEYS
        assert b["earning"] is (b["id"] in EARNING_BUILDINGS)
        if not b["earning"]:
            zeros = {k: 0 for k in BUILDING_KEYS - {"id", "earning", "upgrade_waiting"}}
            assert b == {"id": b["id"], "earning": False, "upgrade_waiting": False, **zeros}
    assert body["belt"]["total_xp"] == sum(b["xp"] for b in body["buildings"])
    assert body["belt"]["level"] == max(1, sum(b["level"] for b in body["buildings"]) // 9)


def test_xp_counts_only(app, client):
    app.state.db_kind = DbKind.PERSONAL
    target = config.data_dir() / "settings" / "settings.toml"
    target.write_text(target.read_text() + ROUTINE)
    sql(
        DbKind.PERSONAL,
        "INSERT INTO tasks (title, category, status, created_at, updated_at) "
        "VALUES ('Secret title', 'personal', 'open', ?, ?)",
        [(STAMP, STAMP)],
    )

    def check(value):
        if isinstance(value, dict):
            for key, item in value.items():
                assert key in BUILDING_KEYS | {"belt", "buildings", "progress", "total_xp"}
                check(item)
        elif isinstance(value, list):
            for item in value:
                check(item)
        elif isinstance(value, str):
            assert value in BUILDING_IDS
        else:
            assert isinstance(value, (int, float))  # bool is an int

    check(get_xp(client))


def test_seen_and_celebrated_roundtrip(client):
    add_gym_done(DbKind.SAMPLE, 1)
    before = building(client, "planner")
    assert before["tier"] >= 1
    assert before["upgrade_waiting"] is True

    response = seen(client, "planner", before["level"])
    assert response.status_code == 204
    assert response.content == b""
    assert celebrated(client, "planner", before["tier"]).status_code == 204
    belt_level = get_xp(client)["belt"]["level"]
    assert seen(client, "belt", belt_level).status_code == 204

    after = building(client, "planner")
    assert after["seen_level"] == before["level"]
    assert after["celebrated_tier"] == before["tier"]
    assert after["upgrade_waiting"] is False
    assert get_xp(client)["belt"]["seen_level"] == belt_level


def test_celebrated_409_above_tier(client):
    tier = building(client, "planner")["tier"]
    response = celebrated(client, "planner", tier + 1)
    assert response.status_code == 409
    assert response.json()["detail"]
    assert building(client, "planner")["celebrated_tier"] == 0
    # A building that isn't earning yet has reached no upgrade.
    assert celebrated(client, "mail", 1).status_code == 409


@pytest.mark.parametrize("key", ["planner", "belt", "mail"])
def test_seen_409_above_the_level_shown(client, key):
    body = get_xp(client)
    levels = {b["id"]: b["level"] for b in body["buildings"]} | {"belt": body["belt"]["level"]}
    response = seen(client, key, levels[key] + 1)
    assert response.status_code == 409
    assert response.json()["detail"]
    assert sql(DbKind.SAMPLE, "SELECT * FROM xp_seen") == []
    assert seen(client, key, levels[key]).status_code == 204


@pytest.mark.parametrize(
    "body",
    [
        {"key": "nowhere", "level": 0},
        {"key": "planner", "level": -1},
        {"key": "planner", "level": 101},
        {"key": "planner", "level": "1"},
        {"key": "planner", "level": True},
        {"key": "planner", "level": 1.5},
        {"key": "planner"},
        {"level": 1},
        {"key": "planner", "level": 1, "extra": 1},
    ],
)
def test_seen_422(client, body):
    assert client.post("/api/xp/seen", json=body).status_code == 422
    assert sql(DbKind.SAMPLE, "SELECT * FROM xp_seen") == []


@pytest.mark.parametrize(
    "body", [{"tier": -1}, {"tier": 11}, {"tier": "1"}, {"tier": True}, {}, {"tier": 0, "x": 1}]
)
def test_celebrated_422(client, body):
    assert client.post("/api/xp/planner/celebrated", json=body).status_code == 422
    assert sql(DbKind.SAMPLE, "SELECT * FROM xp_seen") == []


def test_unknown_building_404(client):
    for key in ("nowhere", "belt"):
        assert celebrated(client, key, 0).status_code == 404
    assert sql(DbKind.SAMPLE, "SELECT * FROM xp_seen") == []


def test_posts_need_the_apps_own_origin(app):
    outsider = TestClient(app, base_url=APP_URL, headers={"origin": "http://example.com"})
    assert seen(outsider, "belt", 1).status_code == 403
    assert celebrated(outsider, "planner", 0).status_code == 403


def test_seen_state_is_per_database(app, client):
    belt_level = get_xp(client)["belt"]["level"]
    assert seen(client, "planner", 5).status_code == 204
    assert seen(client, "belt", belt_level).status_code == 204
    assert celebrated(client, "planner", 1).status_code == 204

    app.state.db_kind = DbKind.PERSONAL
    planner = building(client, "planner")
    assert (planner["seen_level"], planner["celebrated_tier"]) == (0, 0)
    assert get_xp(client)["belt"]["seen_level"] == 0

    app.state.db_kind = DbKind.SAMPLE
    planner = building(client, "planner")
    assert (planner["seen_level"], planner["celebrated_tier"]) == (5, 1)


@pytest.mark.parametrize("kind", [DbKind.SAMPLE, DbKind.PERSONAL])
def test_xp_without_settings_is_503(app, client, kind):
    app.state.db_kind = kind
    (config.data_dir() / "settings" / "settings.toml").unlink()
    for response in (client.get("/api/xp"), seen(client, "belt", 1), celebrated(client, "jobs", 0)):
        assert response.status_code == 503


def test_sample_head_start_only_in_sample(app, client):
    head_start = sample_data.SAMPLE_XP_HEAD_START
    assert set(head_start) == EARNING_BUILDINGS
    for b in get_xp(client)["buildings"]:
        assert b["xp"] == head_start.get(b["id"], 0)
        if b["earning"]:
            assert b["level"] == level_for_xp(b["id"], b["xp"]) > 1
            assert b["tier"] == b["level"] // 10
            assert b["level_start_xp"] == xp_for_level(b["id"], b["level"])

    add_gym_done(DbKind.SAMPLE, 2)  # added on top of the head start
    assert building(client, "planner")["xp"] == head_start["planner"] + 30

    app.state.db_kind = DbKind.PERSONAL
    add_gym_done(DbKind.PERSONAL, 2)
    xp = {b["id"]: b["xp"] for b in get_xp(client)["buildings"]}
    assert xp == dict.fromkeys(BUILDING_IDS, 0) | {"planner": 30}
    assert get_xp(client)["belt"]["total_xp"] == 30


def test_seeded_sample_belt_is_mid_level(client):
    """The head start puts the made-up data near the levels screenshots aim for."""
    sample_data.seed_sample_database(lambda: NOW)
    levels = {b["id"]: b["level"] for b in get_xp(client)["buildings"] if b["earning"]}
    for building_id, aim in {"planner": 34, "finance": 27, "jobs": 22}.items():
        assert abs(levels[building_id] - aim) <= 2, levels


def tick_all(kind: DbKind, routine_id: str, items) -> None:
    sql(
        kind,
        "INSERT INTO routine_ticks (day, routine_id, item, ticked_at) "
        "VALUES ('2026-11-22', ?, ?, ?)",
        [(routine_id, item, STAMP) for item in items],
    )


def finished(kind: DbKind) -> list[tuple]:
    return sql(kind, "SELECT routine_id FROM routine_finishes ORDER BY routine_id")


def add_private_routine() -> None:
    target = config.data_dir() / "settings" / "settings.toml"
    target.write_text(target.read_text() + ROUTINE)


def tick_both_routines(kind: DbKind) -> None:
    """Fully tick Sample's routine and the made-up private one on a past day."""
    sample = sample_data.SAMPLE_ROUTINES[0]
    tick_all(kind, sample.id, sample.items)
    tick_all(kind, "private_prep", ("Alpha", "Beta"))


def start(app) -> None:
    """Start and stop the app as the server does, without the background check."""
    with TestClient(app, base_url=APP_URL):
        assert app.state.reminder_loop is None


def test_xp_requests_never_backfill(client):
    add_private_routine()
    tick_both_routines(DbKind.SAMPLE)
    get_xp(client)
    assert seen(client, "belt", 1).status_code == 204
    assert celebrated(client, "planner", 0).status_code == 204
    assert finished(DbKind.SAMPLE) == []


def test_starting_the_app_backfills_each_database_with_its_own_routines(app):
    add_private_routine()
    tick_both_routines(DbKind.SAMPLE)
    tick_both_routines(DbKind.PERSONAL)
    start(app)
    assert finished(DbKind.SAMPLE) == [(sample_data.SAMPLE_ROUTINES[0].id,)]
    assert finished(DbKind.PERSONAL) == [("private_prep",)]


def test_starting_the_app_creates_no_database(app):
    start(app)
    assert not db_path(DbKind.SAMPLE).exists()
    assert not db_path(DbKind.PERSONAL).exists()


def test_bad_settings_at_start_skip_only_personal(app, caplog):
    tick_both_routines(DbKind.SAMPLE)
    tick_both_routines(DbKind.PERSONAL)
    (config.data_dir() / "settings" / "settings.toml").unlink()
    start(app)
    assert finished(DbKind.SAMPLE) == [(sample_data.SAMPLE_ROUTINES[0].id,)]
    assert finished(DbKind.PERSONAL) == []
    assert "Routine backfill skipped" in caplog.text


def test_a_broken_database_does_not_stop_the_start_or_the_other_one(app, caplog):
    add_private_routine()
    tick_both_routines(DbKind.PERSONAL)
    db_path(DbKind.SAMPLE).write_bytes(b"this is not a database")
    start(app)
    assert finished(DbKind.PERSONAL) == [("private_prep",)]
    assert "Routine backfill skipped the sample database" in caplog.text


@pytest.fixture
def toronto():
    """The Mac's zone is Toronto for one test, then back to what it was."""
    with pytest.MonkeyPatch.context() as patch:
        patch.setenv("TZ", "America/Toronto")
        time.tzset()
        yield
    time.tzset()


def test_each_time_gets_its_own_days_clock_rules(app, client, toronto):
    """Daylight saving: five to-dos fill a day's cap, and a sixth just the other side
    of local midnight counts too. Today's UTC offset, applied to every date, would
    merge the two days in one half of the year."""
    app.state.db_kind = DbKind.PERSONAL
    stamps = [
        # Summer (UTC-4): five on July 1, one at 00:30 on July 2.
        *[datetime(2026, 7, 1, 16, minute, tzinfo=UTC) for minute in range(5)],
        datetime(2026, 7, 2, 4, 30, tzinfo=UTC),
        # Winter (UTC-5): one at 23:30 on January 14, five on January 15.
        datetime(2026, 1, 15, 4, 30, tzinfo=UTC),
        *[datetime(2026, 1, 15, 17, minute, tzinfo=UTC) for minute in range(5)],
    ]
    conn = open_database(db_path(DbKind.PERSONAL), DbKind.PERSONAL)
    try:
        for stamp in stamps:
            tasks = TaskStore(conn, stale_after_days=7, clock=lambda at=stamp: at)
            tasks.complete(tasks.create(title="Made-up task", category="personal").id)
    finally:
        conn.close()
    assert building(client, "planner")["xp"] == 12 * 10


@pytest.mark.parametrize("route", ["seen", "celebrated"])
def test_posts_check_and_save_under_one_write_lock(client, monkeypatch, route):
    """Nothing else can write between working out what's shown and saving it."""
    get_xp(client)  # make the database first
    real = xp_routes.building_view
    blocked = []

    def watching(*args, **kwargs):
        other = sqlite3.connect(db_path(DbKind.SAMPLE), autocommit=True, timeout=0)
        try:
            other.execute("BEGIN IMMEDIATE")
            other.execute("ROLLBACK")
            blocked.append(False)
        except sqlite3.OperationalError:
            blocked.append(True)
        finally:
            other.close()
        return real(*args, **kwargs)

    monkeypatch.setattr(xp_routes, "building_view", watching)
    response = seen(client, "belt", 1) if route == "seen" else celebrated(client, "planner", 1)
    assert response.status_code == 204
    assert blocked == [True] * len(BUILDING_IDS)
    assert len(sql(DbKind.SAMPLE, "SELECT * FROM xp_seen")) == 1


def test_seeded_sample_shows_growth_with_one_upgrade_waiting(client):
    sample_data.seed_sample_database(lambda: NOW)
    body = get_xp(client)
    by_id = {b["id"]: b for b in body["buildings"]}
    for building_id in ("planner", "finance"):
        b = by_id[building_id]
        assert (b["seen_level"], b["celebrated_tier"]) == (b["level"], b["tier"])
    jobs = by_id["jobs"]
    assert (jobs["seen_level"], jobs["celebrated_tier"]) == (jobs["level"], jobs["tier"] - 1)
    assert [b["id"] for b in body["buildings"] if b["upgrade_waiting"]] == ["jobs"]
    assert body["belt"]["seen_level"] == body["belt"]["level"] > 1
    assert {row[0] for row in sql(DbKind.SAMPLE, "SELECT key FROM xp_seen")} == {
        *EARNING_BUILDINGS,
        "belt",
    }


def test_sample_xp_seen_is_seeded_once(client):
    sample_data.seed_sample_database(lambda: NOW)
    first = sql(DbKind.SAMPLE, "SELECT * FROM xp_seen ORDER BY key")
    add_gym_done(DbKind.SAMPLE, 40)  # a demo earns more; seeding again must not mark it seen
    sample_data.seed_sample_database(lambda: NOW)
    assert sql(DbKind.SAMPLE, "SELECT * FROM xp_seen ORDER BY key") == first


def test_xp_seen_is_never_seeded_into_personal(app):
    conn = open_database(db_path(DbKind.PERSONAL), DbKind.PERSONAL)
    try:
        with pytest.raises(DatabaseError):
            sample_data.seed_xp(conn, NOW)
        assert conn.execute("SELECT count(*) FROM xp_seen").fetchone()[0] == 0
    finally:
        conn.close()
