"""Flight School: monthly drafts, proposals, and what accepting a proposal does.

A month (YYYY-MM) holds the owner's draft dump. The model's suggestions arrive as
proposals (checked by flight_proposals.py). Nothing is applied until the owner decides:
accept applies the payload, edit applies his edited payload (checked again), reject
applies nothing. A proposal can be decided once.

Applying: bullet -> fs_bullets; example -> a ready competency example; new_skill -> a
skill with its links (related skills that don't exist yet are skipped) and a first level
event; level_change -> the skill's new level and an event; recommendation -> an open
recommendation; resume_change -> recorded on the proposal only (the master resume
applies accepted changes, see flight_resume.py).

A month is done when it has a decided proposal and none pending: its progress check is
saved and its Mission Control to-do is completed, in the same transaction. Skill names
match without regard to capitals. Stamps are UTC like 2026-11-29T15:00:00Z.
"""

import json
import re
import sqlite3
from collections.abc import Callable
from datetime import UTC, date, datetime

from aicity.competencies import COMPETENCIES
from aicity.db import with_transaction
from aicity.flight_proposals import (
    FlightConflict,
    FlightError,
    FlightNotFound,
    validate_payload,
)
from aicity.tasks import TaskStore, utc_now

__all__ = ["FlightConflict", "FlightError", "FlightNotFound", "FlightStore"]

DRAFT_MAX = 20_000
TARGET_MAX = 3000
_MONTH = re.compile(r"\d{4}-(0[1-9]|1[0-2])")
_STAMP_FORMAT = "%Y-%m-%dT%H:%M:%SZ"
_LINK_STRENGTH = 0.5


class FlightStore:
    """All Flight School reads and writes for one open database."""

    def __init__(
        self,
        conn: sqlite3.Connection,
        tasks: TaskStore,
        *,
        clock: Callable[[], datetime] = utc_now,
    ) -> None:
        self._conn = conn
        self._tasks = tasks
        self._clock = clock

    # --- Drafts -----------------------------------------------------------------

    def save_draft(self, month: str, text: str) -> None:
        _check_month(month)
        if not isinstance(text, str) or len(text) > DRAFT_MAX:
            raise FlightError(f"The draft can be at most {DRAFT_MAX} characters.")

        def work() -> None:
            self._ensure_open_month(month)
            self._conn.execute(
                "UPDATE fs_months SET draft = ?, updated_at = ? WHERE month = ?",
                (text, self._stamp(), month),
            )

        with_transaction(self._conn, work, immediate=True)

    def draft(self, month: str) -> str:
        _check_month(month)
        row = self._conn.execute("SELECT draft FROM fs_months WHERE month = ?", (month,)).fetchone()
        return "" if row is None else row[0]

    def month_status(self, month: str) -> dict:
        _check_month(month)
        row = self._conn.execute(
            "SELECT status, todo_task_id FROM fs_months WHERE month = ?", (month,)
        ).fetchone()
        counts = dict(
            self._conn.execute(
                "SELECT status = 'pending', count(*) FROM fs_proposals WHERE month = ? GROUP BY 1",
                (month,),
            ).fetchall()
        )
        return {
            "status": None if row is None else row[0],
            "pending": counts.get(1, 0),
            "decided": counts.get(0, 0),
            "todo_task_id": None if row is None else row[1],
        }

    # --- Proposals --------------------------------------------------------------

    def add_proposals(self, month: str, items: list[dict]) -> list[int]:
        """Save already-validated proposals for a month (it becomes 'proposed')."""
        _check_month(month)

        def work() -> list[int]:
            self._ensure_open_month(month)
            stamp = self._stamp()
            ids = [
                self._conn.execute(
                    "INSERT INTO fs_proposals (month, kind, payload_json, status, created_at) "
                    "VALUES (?, ?, ?, 'pending', ?)",
                    (month, i["kind"], json.dumps(i["payload"]), stamp),
                ).lastrowid
                for i in items
            ]
            self._conn.execute(
                "UPDATE fs_months SET status = 'proposed', updated_at = ? WHERE month = ?",
                (stamp, month),
            )
            return ids

        return with_transaction(self._conn, work, immediate=True)

    def pending(self, month: str | None = None) -> list[dict]:
        sql = "SELECT id, month, kind, payload_json FROM fs_proposals WHERE status = 'pending'"
        params: tuple = ()
        if month is not None:
            _check_month(month)
            sql += " AND month = ?"
            params = (month,)
        rows = self._conn.execute(sql + " ORDER BY id", params).fetchall()
        return [
            {"id": r[0], "month": r[1], "kind": r[2], "payload": json.loads(r[3])} for r in rows
        ]

    def decide(self, proposal_id: int, action: str, payload: dict | None = None) -> None:
        if action not in ("accept", "edit", "reject"):
            raise FlightError("Decide with accept, edit or reject.")
        row = self._conn.execute(
            "SELECT month, kind, payload_json, status FROM fs_proposals WHERE id = ?",
            (proposal_id,),
        ).fetchone()
        if row is None:
            raise FlightNotFound("No proposal with that id.")
        month, kind, stored, status = row
        if status != "pending":
            raise FlightConflict("That proposal has already been decided.")
        if action == "edit":
            if payload is None:
                raise FlightError("An edit needs the edited proposal.")
            applied = validate_payload(kind, payload)
        else:
            applied = json.loads(stored)

        def work() -> None:
            stamp = self._stamp()
            new_status = {"accept": "accepted", "edit": "edited", "reject": "rejected"}[action]
            self._conn.execute(
                "UPDATE fs_proposals SET status = ?, decided_at = ?, payload_json = ? "
                "WHERE id = ? AND status = 'pending'",
                (new_status, stamp, json.dumps(applied), proposal_id),
            )
            if action != "reject":
                _APPLY[kind](self, month, proposal_id, applied, stamp)
            self._finish_if_done(month, stamp)

        with_transaction(self._conn, work, immediate=True)

    # --- Reading ----------------------------------------------------------------

    def skills(self) -> list[dict]:
        rows = self._conn.execute(
            "SELECT id, name, category, level FROM fs_skills ORDER BY name COLLATE NOCASE"
        ).fetchall()
        return [{"id": r[0], "name": r[1], "category": r[2], "level": r[3]} for r in rows]

    def examples(self) -> list[dict]:
        rows = self._conn.execute(
            "SELECT id, competency_id, month, situation, action, outcome, status "
            "FROM fs_examples ORDER BY id"
        ).fetchall()
        keys = ("id", "competency_id", "month", "situation", "action", "outcome", "status")
        return [dict(zip(keys, r, strict=True)) for r in rows]

    def coverage(self) -> tuple[int, int]:
        ready = self._conn.execute(
            "SELECT count(DISTINCT competency_id) FROM fs_examples WHERE status = 'ready'"
        ).fetchone()[0]
        return ready, len(COMPETENCIES)

    def recommendations(self) -> list[dict]:
        rows = self._conn.execute(
            "SELECT r.id, s.name, r.kind, r.title, r.provider, r.url, r.price, r.free, r.status "
            "FROM fs_recommendations r JOIN fs_skills s ON s.id = r.skill_id ORDER BY r.id"
        ).fetchall()
        keys = ("id", "skill", "kind", "title", "provider", "url", "price", "free", "status")
        return [dict(zip(keys, r, strict=True)) for r in rows]

    # --- Study ------------------------------------------------------------------

    def study_target(self) -> int:
        row = self._conn.execute(
            "SELECT minutes_per_week FROM fs_study_target ORDER BY id DESC LIMIT 1"
        ).fetchone()
        return 0 if row is None else row[0]

    def set_study_target(self, minutes: int) -> None:
        if type(minutes) is not int or not 0 <= minutes <= TARGET_MAX:
            raise FlightError(f"The weekly target must be 0 to {TARGET_MAX} minutes.")
        self._write(
            "INSERT INTO fs_study_target (minutes_per_week, changed_at) VALUES (?, ?)",
            (minutes, self._stamp()),
        )

    def log_study(self, day: str, minutes: int, skill: str | None = None) -> None:
        try:
            date.fromisoformat(day)
        except (TypeError, ValueError):
            raise FlightError("The day must look like 2026-11-29.") from None
        if type(minutes) is not int or not 1 <= minutes <= 600:
            raise FlightError("Minutes must be a whole number from 1 to 600.")
        skill_id = None if skill is None else self._skill_id(skill)
        self._write(
            "INSERT INTO fs_study (day, minutes, skill_id, created_at) VALUES (?, ?, ?, ?)",
            (day, minutes, skill_id, self._stamp()),
        )

    # --- Recommendations --------------------------------------------------------

    def send_recommendation(self, rec_id: int) -> int:
        row = self._conn.execute(
            "SELECT title, status FROM fs_recommendations WHERE id = ?", (rec_id,)
        ).fetchone()
        if row is None:
            raise FlightNotFound("No recommendation with that id.")
        if row[1] != "open":
            raise FlightConflict("Only an open recommendation can be sent to the to-do list.")

        def work() -> int:
            task = self._tasks.create(title=row[0], category="personal")
            self._conn.execute(
                "UPDATE fs_recommendations SET status = 'sent', task_id = ? WHERE id = ?",
                (task.id, rec_id),
            )
            return task.id

        return with_transaction(self._conn, work, immediate=True)

    # --- Applying ---------------------------------------------------------------

    def _apply_bullet(self, month: str, pid: int, p: dict, stamp: str) -> None:
        links = {"skills": p["skills"], "competencies": p["competencies"]}
        self._conn.execute(
            "INSERT INTO fs_bullets (month, text, links_json, proposal_id) VALUES (?, ?, ?, ?)",
            (month, p["text"], json.dumps(links), pid),
        )

    def _apply_example(self, month: str, pid: int, p: dict, stamp: str) -> None:
        self._conn.execute(
            "INSERT INTO fs_examples (competency_id, month, situation, action, outcome, status, "
            "proposal_id, updated_at) VALUES (?, ?, ?, ?, ?, 'ready', ?, ?)",
            (p["competency"], month, p["situation"], p["action"], p["outcome"], pid, stamp),
        )

    def _apply_new_skill(self, month: str, pid: int, p: dict, stamp: str) -> None:
        if self._find_skill(p["name"]) is not None:
            raise FlightConflict("A skill with that name already exists.")
        skill_id = self._conn.execute(
            "INSERT INTO fs_skills (name, category, level, created_at) VALUES (?, ?, ?, ?)",
            (p["name"], p["category"], p["level"], stamp),
        ).lastrowid
        for name in p["related"]:
            other = self._find_skill(name)
            if other is not None and other != skill_id:
                self._conn.execute(
                    "INSERT INTO fs_skill_links (skill_id, other_skill_id, strength) "
                    "VALUES (?, ?, ?)",
                    (skill_id, other, _LINK_STRENGTH),
                )
        for cid in p["competencies"]:
            self._conn.execute(
                "INSERT INTO fs_skill_links (skill_id, competency_id, strength) VALUES (?, ?, ?)",
                (skill_id, cid, _LINK_STRENGTH),
            )
        self._conn.execute(
            "INSERT INTO fs_level_events (skill_id, from_level, to_level, evidence, proposal_id, "
            "at) VALUES (?, NULL, ?, '', ?, ?)",
            (skill_id, p["level"], pid, stamp),
        )

    def _apply_level_change(self, month: str, pid: int, p: dict, stamp: str) -> None:
        skill_id = self._skill_id(p["skill"])
        old = self._conn.execute(
            "SELECT level FROM fs_skills WHERE id = ?", (skill_id,)
        ).fetchone()[0]
        self._conn.execute("UPDATE fs_skills SET level = ? WHERE id = ?", (p["to"], skill_id))
        self._conn.execute(
            "INSERT INTO fs_level_events (skill_id, from_level, to_level, evidence, proposal_id, "
            "at) VALUES (?, ?, ?, ?, ?, ?)",
            (skill_id, old, p["to"], p["evidence"], pid, stamp),
        )

    def _apply_recommendation(self, month: str, pid: int, p: dict, stamp: str) -> None:
        self._conn.execute(
            "INSERT INTO fs_recommendations (skill_id, kind, title, provider, url, price, free, "
            "status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)",
            (
                self._skill_id(p["skill"]),
                p["kind"],
                p["title"],
                p["provider"],
                p["url"],
                p["price"],
                int(p["free"]),
                stamp,
            ),
        )

    def _apply_resume_change(self, month: str, pid: int, p: dict, stamp: str) -> None:
        """Recorded on the proposal; the master resume applies it (flight_resume.py)."""

    # --- Helpers ----------------------------------------------------------------

    def _finish_if_done(self, month: str, stamp: str) -> None:
        status = self.month_status(month)
        if status["status"] == "done" or status["pending"] or not status["decided"]:
            return
        ready, _total = self.coverage()
        new = self._conn.execute(
            "SELECT count(DISTINCT competency_id) FROM fs_examples e WHERE status = 'ready' "
            "AND month = ? AND NOT EXISTS (SELECT 1 FROM fs_examples o WHERE o.status = 'ready' "
            "AND o.competency_id = e.competency_id AND (o.month IS NULL OR o.month < ?))",
            (month, month),
        ).fetchone()[0]
        changes = [
            {"skill": r[0], "from": r[1], "to": r[2]}
            for r in self._conn.execute(
                "SELECT s.name, e.from_level, e.to_level FROM fs_level_events e "
                "JOIN fs_skills s ON s.id = e.skill_id JOIN fs_proposals p ON p.id = e.proposal_id "
                "WHERE p.month = ? ORDER BY e.id",
                (month,),
            )
        ]
        minutes = self._conn.execute(
            "SELECT coalesce(sum(minutes), 0) FROM fs_study WHERE substr(day, 1, 7) = ?", (month,)
        ).fetchone()[0]
        self._conn.execute(
            "INSERT INTO fs_progress (month, competencies_ready, competencies_new, "
            "level_changes_json, study_minutes, made_at) VALUES (?, ?, ?, ?, ?, ?)",
            (month, ready, new, json.dumps(changes), minutes, stamp),
        )
        self._conn.execute(
            "UPDATE fs_months SET status = 'done', done_at = ?, updated_at = ? WHERE month = ?",
            (stamp, stamp, month),
        )
        if status["todo_task_id"] is not None:
            todo = self._tasks.get(status["todo_task_id"])
            if todo.status == "open":
                self._tasks.complete(todo.id)

    def _ensure_open_month(self, month: str) -> None:
        row = self._conn.execute(
            "SELECT status FROM fs_months WHERE month = ?", (month,)
        ).fetchone()
        if row is None:
            self._conn.execute(
                "INSERT INTO fs_months (month, status, updated_at) VALUES (?, 'draft', ?)",
                (month, self._stamp()),
            )
        elif row[0] == "done":
            raise FlightConflict("That month is already done.")

    def _find_skill(self, name: str) -> int | None:
        row = self._conn.execute(
            "SELECT id FROM fs_skills WHERE name = ? COLLATE NOCASE", (name.strip(),)
        ).fetchone()
        return None if row is None else row[0]

    def _skill_id(self, name: str) -> int:
        found = self._find_skill(name)
        if found is None:
            raise FlightError("No skill by that name yet; accept its new skill proposal first.")
        return found

    def _write(self, sql: str, params: tuple) -> None:
        with_transaction(self._conn, lambda: self._conn.execute(sql, params), immediate=True)

    def _stamp(self) -> str:
        now = self._clock()
        if now.tzinfo is None:
            raise ValueError("The clock must return a timezone-aware time.")
        return now.astimezone(UTC).strftime(_STAMP_FORMAT)


_APPLY = {
    "bullet": FlightStore._apply_bullet,
    "example": FlightStore._apply_example,
    "new_skill": FlightStore._apply_new_skill,
    "level_change": FlightStore._apply_level_change,
    "recommendation": FlightStore._apply_recommendation,
    "resume_change": FlightStore._apply_resume_change,
}


def _check_month(month: str) -> None:
    if not isinstance(month, str) or not _MONTH.fullmatch(month):
        raise FlightError("A month must look like 2026-11.")
