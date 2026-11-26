"""Flight School's monthly to-do: "Log last month for Flight School" on the reminder day."""

from datetime import UTC, datetime, time
from types import SimpleNamespace

import pytest

from aicity.career_settings import CareerSettings
from aicity.db import DbKind, open_database
from aicity.flight_reminder import TODO_TITLE, check_flight_todo
from aicity.flight_store import FlightStore
from aicity.tasks import TaskStore

CAREER = CareerSettings(ai="claude_code", local_model=None, reminder_day=1)
NINE = time(9, 0)


@pytest.fixture
def conn(tmp_path):
    c = open_database(tmp_path / "sample.db", DbKind.SAMPLE)
    yield c
    c.close()


def check(conn, when: datetime, career=CAREER):
    tasks = TaskStore(conn, stale_after_days=7, clock=lambda: when.astimezone(UTC))
    return check_flight_todo(conn, when, career, NINE, tasks), tasks


def open_todos(tasks):
    return [t for t in tasks.list_tasks("open") if t.title == TODO_TITLE]


def test_before_the_time_nothing(conn):
    made, tasks = check(conn, datetime(2026, 12, 1, 8, 59))
    assert made == 0 and open_todos(tasks) == []


def test_on_the_day_after_the_time_one_todo(conn):
    made, tasks = check(conn, datetime(2026, 12, 1, 9, 0))
    assert made == 1
    [todo] = open_todos(tasks)
    assert (todo.category, todo.notes) == ("personal", "Run /flight-log in Claude Code.")
    assert todo.reminder_at == "2026-12-01T09:00"
    link = conn.execute("SELECT todo_task_id FROM fs_months WHERE month = '2026-11'").fetchone()
    assert link == (todo.id,)


def test_closed_on_the_first_still_gets_it_once(conn):
    made, _ = check(conn, datetime(2026, 12, 4, 20, 0))
    assert made == 1
    made, tasks = check(conn, datetime(2026, 12, 5, 20, 0))
    assert made == 0 and len(open_todos(tasks)) == 1


def test_done_month_never_gets_one(conn):
    tasks = TaskStore(conn, stale_after_days=7, clock=lambda: datetime(2026, 12, 1, tzinfo=UTC))
    store = FlightStore(conn, tasks, clock=lambda: datetime(2026, 11, 30, tzinfo=UTC))
    [pid] = store.add_proposals(
        "2026-11",
        [
            {
                "kind": "example",
                "payload": {"competency": "2.1", "situation": "S", "action": "A", "outcome": "O"},
            }
        ],
    )
    store.decide(pid, "reject")
    made, tasks = check(conn, datetime(2026, 12, 1, 10, 0))
    assert made == 0 and open_todos(tasks) == []


def test_a_later_reminder_day(conn):
    career = CareerSettings(ai="claude_code", local_model=None, reminder_day=3)
    assert check(conn, datetime(2026, 12, 2, 12, 0), career)[0] == 0
    assert check(conn, datetime(2026, 12, 3, 12, 0), career)[0] == 1


def test_january_asks_for_december(conn):
    check(conn, datetime(2027, 1, 1, 9, 30))
    assert conn.execute("SELECT month FROM fs_months").fetchone() == ("2026-12",)


# --- From the background reminder check ---------------------------------------------


class FakeSettings:
    def __init__(self, career):
        from aicity.settings import TaskDefaults

        self.career = career
        self.tasks = TaskDefaults(stale_after_days=7, reminder_time=NINE)
        self.plan = None
        self.routines = ()
        # The statement reminder isn't due on the 1st with a due day of 28.
        self.income = SimpleNamespace(statement_due_day=28)


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    from aicity import config

    monkeypatch.setenv(config.DATA_DIR_ENV, str(tmp_path))
    return tmp_path


def run_check(career):
    from aicity.reminder_loop import check_all_databases

    when = datetime(2026, 12, 1, 15, 0, tzinfo=UTC)  # after 9:00 anywhere in the Americas
    return check_all_databases(lambda: when, load=lambda: FakeSettings(career))


def titles(kind):
    from aicity.db import db_path

    c = open_database(db_path(kind), kind)
    try:
        return [r[0] for r in c.execute("SELECT title FROM tasks")]
    finally:
        c.close()


def test_reminder_check_makes_it_in_personal_only(data_dir):
    from aicity.db import db_path

    for kind in DbKind:
        open_database(db_path(kind), kind).close()
    run_check(CAREER)
    assert titles(DbKind.PERSONAL) == [TODO_TITLE]
    assert titles(DbKind.SAMPLE) == []


def test_no_career_section_no_todo(data_dir):
    from aicity.db import db_path

    open_database(db_path(DbKind.PERSONAL), DbKind.PERSONAL).close()
    run_check(None)
    assert titles(DbKind.PERSONAL) == []
