"""scripts/flight.py: the helper /flight-log uses from Claude Code (made-up text only)."""

import importlib.util
import io
import json
from pathlib import Path

import pytest

from aicity import config
from aicity.db import DbKind, db_path, open_database

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "flight.py"
spec = importlib.util.spec_from_file_location("flight_cli", SCRIPT)
flight = importlib.util.module_from_spec(spec)
spec.loader.exec_module(flight)

EXAMPLE = {
    "kind": "example",
    "payload": {"competency": "2.1", "situation": "S", "action": "A", "outcome": "O"},
}
SKILL = {
    "kind": "new_skill",
    "payload": {
        "name": "Design review",
        "category": 1,
        "level": 2,
        "related": [],
        "competencies": [],
    },
}


@pytest.fixture
def personal(tmp_path, monkeypatch):
    monkeypatch.setenv(config.DATA_DIR_ENV, str(tmp_path))
    open_database(db_path(DbKind.PERSONAL), DbKind.PERSONAL).close()
    return tmp_path


def run(argv, stdin="", monkeypatch=None):
    out = io.StringIO()
    err = io.StringIO()
    code = flight.main(argv, stdin=io.StringIO(stdin), stdout=out, stderr=err)
    return code, out.getvalue(), err.getvalue()


def write(tmp_path, data, name="p.json"):
    f = tmp_path / name
    f.write_text(json.dumps(data))
    return str(f)


def test_save_draft_appends_and_draft_prints(personal):
    assert run(["save-draft", "2026-11"], "First part.")[0] == 0
    assert run(["save-draft", "2026-11"], "Second part.")[0] == 0
    code, out, _ = run(["draft", "2026-11"])
    assert code == 0 and out == "First part.\n\nSecond part.\n"
    run(["save-draft", "2026-11", "--replace"], "Only this.")
    assert run(["draft", "2026-11"])[1] == "Only this.\n"


def test_propose_pending_decide_status(personal):
    code, out, _ = run(["propose", "2026-11", write(personal, [SKILL, EXAMPLE])])
    assert code == 0 and "new_skill: 1" in out and "example: 1" in out
    code, out, _ = run(["pending", "2026-11"])
    lines = out.strip().splitlines()
    assert len(lines) == 2 and lines[0].startswith("1 new_skill")
    assert run(["decide", "1", "accept"])[0] == 0
    edited = {**EXAMPLE["payload"], "outcome": "Better"}
    assert run(["decide", "2", "edit", write(personal, edited, "e.json")])[0] == 0
    code, out, _ = run(["status", "2026-11"])
    assert "done" in out and "1 / 34" in out


def test_bad_proposals_file_saves_nothing(personal):
    bad = [EXAMPLE, {"kind": "example", "payload": {**EXAMPLE["payload"], "outcome": "x" * 301}}]
    code, _, err = run(["propose", "2026-11", write(personal, bad)])
    assert code == 2 and "item 2" in err
    assert run(["pending"])[1] == ""


def test_not_json_is_a_clear_error(personal):
    f = personal / "x.json"
    f.write_text("not json")
    code, _, err = run(["propose", "2026-11", str(f)])
    assert code == 2 and "JSON" in err


def test_decide_twice_and_unknown(personal):
    run(["propose", "2026-11", write(personal, [EXAMPLE])])
    run(["decide", "1", "reject"])
    assert run(["decide", "1", "accept"])[0] == 2
    assert run(["decide", "99", "accept"])[0] == 2


def test_no_personal_database(tmp_path, monkeypatch):
    monkeypatch.setenv(config.DATA_DIR_ENV, str(tmp_path))
    code, _, err = run(["status"])
    assert code == 2 and "Open the app once first." in err
    assert not db_path(DbKind.PERSONAL).exists()


def test_never_touches_the_sample_database(personal):
    run(["save-draft", "2026-11"], "Text.")
    sample = db_path(DbKind.SAMPLE)
    assert not sample.exists()


def test_bad_month_is_exit_2(personal):
    assert run(["draft", "November"])[0] == 2


def test_context_lists_skills_competencies_and_recommendations(personal):
    rec = {
        "kind": "recommendation",
        "payload": {
            "skill": "Design review",
            "kind": "task",
            "title": "Shadow a peer review",
            "provider": "",
            "url": None,
            "price": "",
            "free": True,
        },
    }
    run(["propose", "2026-11", write(personal, [SKILL, EXAMPLE, rec])])
    for pid in ("1", "2", "3"):
        run(["decide", pid, "accept"])
    code, out, _ = run(["context"])
    assert code == 0
    assert "Design review (category 1, level 2)" in out
    assert "[ready] 2.1" in out and "[empty] 2.2" in out
    assert out.count("[ready]") + out.count("[empty]") == 34
    assert "Shadow a peer review" in out


def test_resume_import_preview_confirm_and_export(personal):
    from docx import Document

    src = personal / "resume.docx"
    doc = Document()
    doc.add_heading("Experience", level=1)
    doc.add_paragraph("Designed duct layouts")
    doc.save(src)
    code, out, _ = run(["resume-import", str(src)])
    assert code == 0 and "Experience: 1 item" in out and "--confirm" in out
    assert "Experience" not in run(["context"])[1].split("RESUME")[1]  # nothing saved yet
    code, out, _ = run(["resume-import", str(src), "--confirm"])
    assert code == 0 and "v1" in out
    assert "Designed duct layouts" in run(["context"])[1]
    dest = personal / "out.docx"
    assert run(["resume-export", str(dest)])[0] == 0 and dest.exists()
    assert run(["resume-import", str(src), "--confirm"])[0] == 2  # only once


def test_resume_export_without_a_resume(personal):
    assert run(["resume-export", str(personal / "x.docx")])[0] == 2
