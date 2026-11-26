"""Flight School's master resume: Word import, approved changes, versions and Word export.

Import is two steps: preview_import reads a .docx into sections (headings start a section;
a Title-styled heading starts the header, the name and contact details, which is exported
but never shown to a model; other non-empty paragraphs become items; tables are skipped;
no headings at all gives one "Resume" section) and saves nothing; confirm_import saves it once, labels it "v1 Mon YYYY",
and applies any resume changes the owner accepted before the resume existed.

Changes come from accepted resume_change proposals: add (to a section, created if new),
replace (an item by id) or remove (archives the item). A month with an applied change bumps
the version ("v5 Nov 2026"). Export writes a fresh .docx from the current sections.
"""

import json
import sqlite3
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from pathlib import Path

from docx import Document
from docx.opc.exceptions import PackageNotFoundError

from aicity.db import with_transaction
from aicity.flight_proposals import FlightConflict, FlightError

_STAMP_FORMAT = "%Y-%m-%dT%H:%M:%SZ"
_TITLE_MAX = 60
_ITEM_MAX = 600


@dataclass
class Section:
    title: str
    items: list[str] = field(default_factory=list)
    header: bool = False  # the title block: name and contact details


def preview_import(path: Path) -> list[Section]:
    """Read a Word resume into sections. Saves nothing."""
    try:
        doc = Document(str(path))
    except (PackageNotFoundError, ValueError, KeyError, OSError):
        raise FlightError("That file couldn't be read as a Word document (.docx).") from None
    sections: list[Section] = []
    for para in doc.paragraphs:
        text = " ".join(para.text.split())
        if not text:
            continue
        style = (para.style.name if para.style is not None else "") or ""
        if style == "Title":
            sections.append(Section(text[:_TITLE_MAX], header=True))
        elif style.startswith("Heading"):
            sections.append(Section(text[:_TITLE_MAX]))
        else:
            if not sections:
                sections.append(Section("Resume"))
            sections[-1].items.append(text[:_ITEM_MAX])
    sections = [s for s in sections if s.items] or []
    if not sections:
        raise FlightError("The document has nothing to import.")
    return _merge_same_titles(sections)


def confirm_import(conn: sqlite3.Connection, sections: list[Section], *, now: datetime) -> str:
    """Save the previewed resume once; returns its first version label."""
    stamp = _stamp(now)

    def work() -> str:
        if conn.execute("SELECT 1 FROM fs_resume_sections LIMIT 1").fetchone():
            raise FlightConflict("A resume has already been imported.")
        for pos, s in enumerate(sections):
            sid = conn.execute(
                "INSERT INTO fs_resume_sections (position, title, header) VALUES (?, ?, ?)",
                (pos, s.title, int(s.header)),
            ).lastrowid
            for ipos, text in enumerate(s.items):
                conn.execute(
                    "INSERT INTO fs_resume_items (section_id, position, text, updated_at) "
                    "VALUES (?, ?, ?, ?)",
                    (sid, ipos, text, stamp),
                )
        waiting = conn.execute(
            "SELECT p.id, p.payload_json FROM fs_proposals p WHERE p.kind = 'resume_change' "
            "AND p.status IN ('accepted', 'edited') AND p.id NOT IN "
            "(SELECT proposal_id FROM fs_resume_applied) ORDER BY p.id"
        ).fetchall()
        for pid, payload in waiting:
            apply_resume_change(conn, json.loads(payload), now=now)
            record_applied(conn, pid, now=now)
        return _save_version(conn, now.astimezone(UTC).date(), stamp)

    return with_transaction(conn, work, immediate=True)


def resume_imported(conn: sqlite3.Connection) -> bool:
    return conn.execute("SELECT 1 FROM fs_resume_sections LIMIT 1").fetchone() is not None


def apply_resume_change(
    conn: sqlite3.Connection, payload: dict, *, now: datetime | None = None
) -> None:
    stamp = _stamp(now or datetime.now(UTC))
    action, text = payload["action"], payload["text"]
    if action == "add":
        sid = _section_id(conn, payload["section"])
        pos = conn.execute(
            "SELECT coalesce(max(position) + 1, 0) FROM fs_resume_items WHERE section_id = ?",
            (sid,),
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO fs_resume_items (section_id, position, text, updated_at) "
            "VALUES (?, ?, ?, ?)",
            (sid, pos, text, stamp),
        )
        return
    row = conn.execute(
        "SELECT id FROM fs_resume_items WHERE id = ? AND archived_at IS NULL", (payload["item"],)
    ).fetchone()
    if row is None:
        raise FlightError("No current resume item has that item id.")
    if action == "replace":
        conn.execute(
            "UPDATE fs_resume_items SET text = ?, updated_at = ? WHERE id = ?",
            (text, stamp, payload["item"]),
        )
    else:
        conn.execute(
            "UPDATE fs_resume_items SET archived_at = ?, updated_at = ? WHERE id = ?",
            (stamp, stamp, payload["item"]),
        )


def record_applied(conn: sqlite3.Connection, proposal_id: int, *, now: datetime) -> None:
    conn.execute(
        "INSERT INTO fs_resume_applied (proposal_id, applied_at) VALUES (?, ?)",
        (proposal_id, _stamp(now)),
    )


def bump_version(conn: sqlite3.Connection, month: str, *, now: datetime) -> str:
    """A new version labelled with the month ("v2 Nov 2026")."""
    year, mon = (int(x) for x in month.split("-"))
    return _save_version(conn, date(year, mon, 1), _stamp(now))


def resume_sections(conn: sqlite3.Connection, *, include_header: bool = True) -> list[dict]:
    """The current resume. include_header=False leaves out the title block (name and contact
    details), for anything shown to a model."""
    sql = "SELECT id, title, header FROM fs_resume_sections"
    if not include_header:
        sql += " WHERE header = 0"
    sections = conn.execute(sql + " ORDER BY position, id").fetchall()
    out = []
    for sid, title, header in sections:
        items = conn.execute(
            "SELECT id, text FROM fs_resume_items WHERE section_id = ? AND archived_at IS NULL "
            "ORDER BY position, id",
            (sid,),
        ).fetchall()
        out.append(
            {
                "id": sid,
                "title": title,
                "header": bool(header),
                "items": [{"id": i, "text": t} for i, t in items],
            }
        )
    return out


def export_docx(conn: sqlite3.Connection, path: Path) -> None:
    doc = Document()
    for s in resume_sections(conn):
        doc.add_heading(s["title"], level=0 if s["header"] else 1)
        for item in s["items"]:
            doc.add_paragraph(item["text"])
    doc.save(str(path))


# --- Helpers -------------------------------------------------------------------------


def _section_id(conn: sqlite3.Connection, title: str) -> int:
    title = title.strip()[:_TITLE_MAX]
    row = conn.execute(
        "SELECT id FROM fs_resume_sections WHERE title = ? COLLATE NOCASE", (title,)
    ).fetchone()
    if row:
        return row[0]
    pos = conn.execute("SELECT coalesce(max(position) + 1, 0) FROM fs_resume_sections").fetchone()[
        0
    ]
    return conn.execute(
        "INSERT INTO fs_resume_sections (position, title) VALUES (?, ?)", (pos, title)
    ).lastrowid


def _save_version(conn: sqlite3.Connection, month_of: date, stamp: str) -> str:
    n = conn.execute("SELECT count(*) FROM fs_resume_versions").fetchone()[0] + 1
    label = f"v{n} {month_of:%b %Y}"
    conn.execute(
        "INSERT INTO fs_resume_versions (label, snapshot_json, created_at) VALUES (?, ?, ?)",
        (label, json.dumps(resume_sections(conn)), stamp),
    )
    return label


def _merge_same_titles(sections: list[Section]) -> list[Section]:
    merged: dict[str, Section] = {}
    for s in sections:
        key = s.title.lower()
        if key in merged:
            merged[key].items.extend(s.items)
        else:
            merged[key] = Section(s.title, list(s.items), s.header)
    return list(merged.values())


def _stamp(now: datetime) -> str:
    return now.astimezone(UTC).strftime(_STAMP_FORMAT)
