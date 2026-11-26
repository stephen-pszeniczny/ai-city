"""Flight School's master resume: Word import (preview, then confirm), changes, versions, export.

Every resume here is generated in the test; never a real one.
"""

from datetime import UTC, datetime

import pytest
from docx import Document

from aicity.db import DbKind, open_database
from aicity.flight_proposals import FlightConflict, FlightError
from aicity.flight_resume import (
    apply_resume_change,
    confirm_import,
    export_docx,
    preview_import,
    resume_sections,
)
from aicity.flight_store import FlightStore
from aicity.tasks import TaskStore

NOW = datetime(2026, 11, 26, 15, 0, tzinfo=UTC)


@pytest.fixture
def conn(tmp_path):
    c = open_database(tmp_path / "sample.db", DbKind.SAMPLE)
    yield c
    c.close()


def make_docx(path, blocks):
    doc = Document()
    for kind, text in blocks:
        if kind == "h":
            doc.add_heading(text, level=1)
        elif kind == "table":
            doc.add_table(rows=1, cols=1).cell(0, 0).text = text
        else:
            doc.add_paragraph(text)
    doc.save(path)
    return path


RESUME = [
    ("h", "Experience"),
    ("p", "Designed duct layouts"),
    ("p", ""),
    ("p", "Checked calculations"),
    ("h", "Skills"),
    ("p", "Python"),
    ("table", "In a table"),
]


def test_headings_become_sections(tmp_path, conn):
    sections = preview_import(make_docx(tmp_path / "r.docx", RESUME))
    assert [(s.title, s.items) for s in sections] == [
        ("Experience", ["Designed duct layouts", "Checked calculations"]),
        ("Skills", ["Python"]),
    ]
    assert resume_sections(conn) == []  # nothing saved by a preview


def test_no_headings_makes_one_section(tmp_path):
    sections = preview_import(make_docx(tmp_path / "r.docx", [("p", "One"), ("p", "Two")]))
    assert [(s.title, s.items) for s in sections] == [("Resume", ["One", "Two"])]


def test_an_empty_or_unreadable_file_is_a_clear_error(tmp_path):
    with pytest.raises(FlightError, match="nothing"):
        preview_import(make_docx(tmp_path / "e.docx", [("p", "")]))
    bad = tmp_path / "bad.docx"
    bad.write_text("not a word file")
    with pytest.raises(FlightError, match="Word"):
        preview_import(bad)


def test_confirm_saves_and_labels_v1(tmp_path, conn):
    label = confirm_import(conn, preview_import(make_docx(tmp_path / "r.docx", RESUME)), now=NOW)
    assert label == "v1 Nov 2026"
    titles = [(s["title"], [i["text"] for i in s["items"]]) for s in resume_sections(conn)]
    assert titles[0] == ("Experience", ["Designed duct layouts", "Checked calculations"])
    with pytest.raises(FlightConflict):
        confirm_import(conn, preview_import(make_docx(tmp_path / "r.docx", RESUME)), now=NOW)


def imported(tmp_path, conn):
    confirm_import(conn, preview_import(make_docx(tmp_path / "r.docx", RESUME)), now=NOW)
    return {s["title"]: s for s in resume_sections(conn)}


def test_add_replace_remove(tmp_path, conn):
    sections = imported(tmp_path, conn)
    first = sections["Experience"]["items"][0]["id"]
    apply_resume_change(
        conn, {"section": "experience", "action": "add", "item": None, "text": "Automated a table"}
    )
    apply_resume_change(
        conn,
        {
            "section": "Experience",
            "action": "replace",
            "item": first,
            "text": "Designed ventilation layouts",
        },
    )
    apply_resume_change(
        conn,
        {
            "section": "Skills",
            "action": "remove",
            "item": sections["Skills"]["items"][0]["id"],
            "text": "",
        },
    )
    apply_resume_change(
        conn, {"section": "Certifications", "action": "add", "item": None, "text": "First aid"}
    )
    now = {s["title"]: [i["text"] for i in s["items"]] for s in resume_sections(conn)}
    assert now["Experience"] == [
        "Designed ventilation layouts",
        "Checked calculations",
        "Automated a table",
    ]
    assert now["Skills"] == []
    assert now["Certifications"] == ["First aid"]


def test_replace_unknown_item_is_refused(tmp_path, conn):
    imported(tmp_path, conn)
    with pytest.raises(FlightError, match="item"):
        apply_resume_change(
            conn, {"section": "Experience", "action": "replace", "item": 999, "text": "x"}
        )


def change(text):
    return {
        "kind": "resume_change",
        "payload": {"section": "Experience", "action": "add", "item": None, "text": text},
    }


def test_changes_accepted_before_import_are_applied(tmp_path, conn):
    tasks = TaskStore(conn, stale_after_days=7, clock=lambda: NOW)
    store = FlightStore(conn, tasks, clock=lambda: NOW)
    [a, b] = store.add_proposals("2026-10", [change("Older change"), change("Rejected one")])
    store.decide(a, "accept")
    store.decide(b, "reject")
    imported(tmp_path, conn)
    texts = [i["text"] for s in resume_sections(conn) for i in s["items"]]
    assert "Older change" in texts and "Rejected one" not in texts


def test_after_import_a_change_applies_at_once_and_bumps_the_version(tmp_path, conn):
    imported(tmp_path, conn)
    tasks = TaskStore(conn, stale_after_days=7, clock=lambda: NOW)
    store = FlightStore(conn, tasks, clock=lambda: NOW)
    [pid] = store.add_proposals("2026-11", [change("New this month")])
    store.decide(pid, "accept")
    texts = [i["text"] for s in resume_sections(conn) for i in s["items"]]
    assert texts.count("New this month") == 1
    label = conn.execute("SELECT resume_label FROM fs_progress WHERE month = '2026-11'").fetchone()
    assert label == ("v2 Nov 2026",)


def test_export_round_trips(tmp_path, conn):
    imported(tmp_path, conn)
    out = tmp_path / "out.docx"
    export_docx(conn, out)
    again = preview_import(out)
    assert [(s.title, s.items) for s in again] == [
        ("Experience", ["Designed duct layouts", "Checked calculations"]),
        ("Skills", ["Python"]),
    ]


def test_the_title_block_is_a_header_kept_out_of_model_context(tmp_path, conn):
    doc = Document()
    doc.add_heading("Made-up Person", 0)  # the Title style
    doc.add_paragraph("made-up@example.com · 555-0100")
    doc.add_heading("Experience", 1)
    doc.add_paragraph("Checked calculations")
    doc.save(tmp_path / "t.docx")
    sections = preview_import(tmp_path / "t.docx")
    assert [(s.title, s.header) for s in sections] == [
        ("Made-up Person", True),
        ("Experience", False),
    ]
    confirm_import(conn, sections, now=NOW)
    shown = resume_sections(conn, include_header=False)
    assert [s["title"] for s in shown] == ["Experience"]
    out = tmp_path / "o.docx"
    export_docx(conn, out)  # the export keeps the header
    assert preview_import(out)[0].title == "Made-up Person"


def test_proposals_never_change_the_header(tmp_path, conn):
    doc = Document()
    doc.add_heading("Made-up Person", 0)
    doc.add_paragraph("made-up@example.com")
    doc.add_heading("Experience", 1)
    doc.add_paragraph("Checked calculations")
    doc.save(tmp_path / "h.docx")
    confirm_import(conn, preview_import(tmp_path / "h.docx"), now=NOW)
    header_item = resume_sections(conn)[0]["items"][0]["id"]
    with pytest.raises(FlightError, match="header"):
        apply_resume_change(
            conn, {"section": "Experience", "action": "replace", "item": header_item, "text": "x"}
        )
    with pytest.raises(FlightError, match="header"):
        apply_resume_change(
            conn, {"section": "made-up person", "action": "add", "item": None, "text": "x"}
        )
