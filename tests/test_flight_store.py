"""Flight School store: drafts, proposals and what accepting them does.

Every log, skill and example here is made up.
"""

from datetime import UTC, datetime

import pytest

from aicity.db import DbKind, open_database
from aicity.flight_store import FlightConflict, FlightError, FlightNotFound, FlightStore
from aicity.tasks import TaskStore

NOW = datetime(2026, 12, 2, 15, 0, tzinfo=UTC)


@pytest.fixture
def conn(tmp_path):
    c = open_database(tmp_path / "sample.db", DbKind.SAMPLE)
    yield c
    c.close()


@pytest.fixture
def tasks(conn):
    return TaskStore(conn, stale_after_days=7, clock=lambda: NOW)


@pytest.fixture
def store(conn, tasks):
    return FlightStore(conn, tasks, clock=lambda: NOW)


def item(proposal_kind, /, **payload):
    return {"kind": proposal_kind, "payload": payload}


SKILL = item(
    "new_skill", name="Design review", category=1, level=2, related=[], competencies=["1.9"]
)
BULLET = item(
    "bullet",
    text="Reviewed a design with two other disciplines",
    skills=["Design review"],
    competencies=["4.1"],
)
EXAMPLE = item("example", competency="2.2", situation="S", action="I wrote", outcome="O")


def propose(store, *items, month="2026-11"):
    return store.add_proposals(month, list(items))


# --- Drafts -----------------------------------------------------------------------


def test_save_and_read_a_draft(store):
    store.save_draft("2026-11", "Did a load review.")
    assert store.draft("2026-11") == "Did a load review."
    assert store.month_status("2026-11")["status"] == "draft"


def test_unknown_month_has_an_empty_draft(store):
    assert store.draft("2026-10") == ""


@pytest.mark.parametrize("month", ["2026-13", "Nov 2026", "2026-1"])
def test_bad_month(store, month):
    with pytest.raises(FlightError):
        store.save_draft(month, "x")


def test_draft_too_long(store):
    with pytest.raises(FlightError):
        store.save_draft("2026-11", "x" * 20001)


# --- Proposals and deciding --------------------------------------------------------


def test_add_proposals_marks_the_month_proposed(store):
    ids = propose(store, BULLET, EXAMPLE)
    assert len(ids) == 2
    assert store.month_status("2026-11")["status"] == "proposed"
    assert [p["kind"] for p in store.pending("2026-11")] == ["bullet", "example"]


def test_accept_applies_each_kind(store, conn):
    ids = propose(
        store,
        SKILL,
        BULLET,
        EXAMPLE,
        item("level_change", skill="design REVIEW", to=3, evidence="Led two reviews"),
        item(
            "recommendation",
            skill="Design review",
            kind="course",
            title="Review basics",
            provider="",
            url=None,
            price="Free",
            free=True,
        ),
    )
    for pid in ids:
        store.decide(pid, "accept")
    [skill] = store.skills()
    assert (skill["name"], skill["level"], skill["category"]) == ("Design review", 3, 1)
    assert conn.execute("SELECT text FROM fs_bullets").fetchone()[0].startswith("Reviewed")
    assert [(e["competency_id"], e["status"]) for e in store.examples()] == [("2.2", "ready")]
    assert conn.execute("SELECT count(*) FROM fs_level_events").fetchone()[0] == 2
    assert conn.execute("SELECT status FROM fs_recommendations").fetchone()[0] == "open"


def test_edit_applies_the_edited_payload(store):
    [pid] = propose(store, EXAMPLE)
    store.decide(pid, "edit", {**EXAMPLE["payload"], "outcome": "Better outcome"})
    assert store.examples()[0]["outcome"] == "Better outcome"


def test_edit_is_validated_again(store):
    [pid] = propose(store, EXAMPLE)
    with pytest.raises(FlightError, match="outcome"):
        store.decide(pid, "edit", {**EXAMPLE["payload"], "outcome": "x" * 301})
    assert store.pending("2026-11")  # still waiting


def test_reject_applies_nothing(store):
    [pid] = propose(store, EXAMPLE)
    store.decide(pid, "reject")
    assert store.examples() == []


def test_deciding_twice_is_refused(store):
    [pid, _other] = propose(store, EXAMPLE, BULLET)
    store.decide(pid, "accept")
    with pytest.raises(FlightConflict):
        store.decide(pid, "accept")
    with pytest.raises(FlightConflict):
        store.decide(pid, "reject")
    assert len(store.examples()) == 1


def test_unknown_proposal_and_action(store):
    with pytest.raises(FlightNotFound):
        store.decide(999, "accept")
    [pid] = propose(store, EXAMPLE)
    with pytest.raises(FlightError):
        store.decide(pid, "maybe")


def test_level_change_for_unknown_skill(store):
    [pid] = propose(store, item("level_change", skill="Nope", to=2, evidence=""))
    with pytest.raises(FlightError, match="new skill"):
        store.decide(pid, "accept")


def test_new_skill_then_level_change_in_one_batch(store):
    [skill, change] = propose(
        store, SKILL, item("level_change", skill="Design review", to=4, evidence="")
    )
    store.decide(skill, "accept")
    store.decide(change, "accept")
    assert store.skills()[0]["level"] == 4


def test_duplicate_new_skill_is_refused(store):
    [a, b] = propose(
        store, SKILL, {**SKILL, "payload": {**SKILL["payload"], "name": "DESIGN review"}}
    )
    store.decide(a, "accept")
    with pytest.raises(FlightConflict):
        store.decide(b, "accept")


def test_resume_change_is_recorded_only(store, conn):
    [pid] = propose(
        store,
        item(
            "resume_change", section="Experience", action="add", item=None, text="Reviewed designs"
        ),
    )
    store.decide(pid, "accept")
    status = conn.execute("SELECT status FROM fs_proposals WHERE id = ?", (pid,)).fetchone()[0]
    assert status == "accepted"


def test_done_month_refuses_new_drafts_and_proposals(store):
    [pid] = propose(store, EXAMPLE)
    store.decide(pid, "accept")
    with pytest.raises(FlightConflict):
        store.save_draft("2026-11", "more")
    with pytest.raises(FlightConflict):
        propose(store, BULLET)


# --- A month finishing --------------------------------------------------------------


def test_month_done_saves_progress_and_completes_the_todo(store, tasks, conn):
    todo = tasks.create(title="Log last month for Flight School", category="personal")
    conn.execute(
        "INSERT INTO fs_months (month, status, todo_task_id, updated_at) "
        "VALUES ('2026-11', 'draft', ?, '2026-12-01T14:00:00Z')",
        (todo.id,),
    )
    store.log_study("2026-11-20", 45)
    ids = propose(
        store, SKILL, EXAMPLE, item("level_change", skill="Design review", to=3, evidence="")
    )
    for pid in ids[:-1]:
        store.decide(pid, "accept")
    assert store.month_status("2026-11")["status"] == "proposed"
    store.decide(ids[-1], "accept")
    assert store.month_status("2026-11")["status"] == "done"
    row = conn.execute(
        "SELECT competencies_ready, competencies_new, level_changes_json, "
        "study_minutes FROM fs_progress WHERE month = '2026-11'"
    ).fetchone()
    assert row[:2] == (1, 1)
    assert '"to": 3' in row[2]
    assert row[3] == 45
    assert tasks.get(todo.id).status == "done"


def test_all_rejected_still_finishes_the_month(store):
    [pid] = propose(store, EXAMPLE)
    store.decide(pid, "reject")
    assert store.month_status("2026-11")["status"] == "done"


# --- Coverage, study, recommendations ------------------------------------------------


def test_coverage_counts_each_competency_once(store):
    ids = propose(
        store,
        EXAMPLE,
        EXAMPLE,
        item("example", competency="1.4", situation="S", action="A", outcome="O"),
    )
    for pid in ids:
        store.decide(pid, "accept")
    assert store.coverage() == (2, 34)


def test_study_target_history_and_logging_without_a_target(store, conn):
    assert store.study_target() == 0
    store.log_study("2026-12-01", 30)
    store.set_study_target(120)
    store.set_study_target(60)
    assert store.study_target() == 60
    assert conn.execute("SELECT count(*) FROM fs_study_target").fetchone()[0] == 2
    with pytest.raises(FlightError):
        store.set_study_target(-1)
    with pytest.raises(FlightError):
        store.log_study("2026-12-01", 0)
    with pytest.raises(FlightError):
        store.log_study("2026-12-01", 30, skill="Nope")


def test_send_recommendation_makes_one_todo(store, tasks):
    ids = propose(
        store,
        SKILL,
        item(
            "recommendation",
            skill="Design review",
            kind="task",
            title="Shadow a peer review",
            provider="",
            url=None,
            price="",
            free=True,
        ),
    )
    for pid in ids:
        store.decide(pid, "accept")
    [rec] = store.recommendations()
    task_id = store.send_recommendation(rec["id"])
    assert tasks.get(task_id).title == "Shadow a peer review"
    assert tasks.get(task_id).category == "personal"
    with pytest.raises(FlightConflict):
        store.send_recommendation(rec["id"])
