"""Flight School helper for the monthly run in Claude Code (/flight-log).

    flight.py save-draft YYYY-MM [--replace]   read text from stdin; add it to the month's draft
    flight.py draft YYYY-MM                    print the month's draft
    flight.py propose YYYY-MM FILE             check a proposals file and save it as pending
    flight.py pending [YYYY-MM]                list proposals waiting for a decision
    flight.py decide ID accept|reject          decide one proposal
    flight.py decide ID edit FILE              accept it with your edited payload (JSON file)
    flight.py status [YYYY-MM]                 the month's status and competency coverage
    flight.py context                          existing skills, the 34 competencies (ready or
                                               empty), open recommendations and the resume
    flight.py resume-import PATH [--confirm]   preview a Word resume; --confirm saves it (once)
    flight.py resume-export PATH               write the current resume as a Word file

Works only on the Personal database, and never creates it (open the app once first).
Prints only what was asked for. Exit 0 on success, 2 with a one-line message otherwise.
"""

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
# The app code lives in src/; add it to the path before importing from it.
sys.path.insert(0, str(REPO_ROOT / "src"))

from aicity.competencies import CATEGORIES, COMPETENCIES
from aicity.db import DbKind, db_path, open_database
from aicity.flight_proposals import validate_proposals
from aicity.flight_resume import (
    confirm_import,
    export_docx,
    preview_import,
    resume_imported,
    resume_sections,
)
from aicity.flight_store import (
    FlightConflict,
    FlightError,
    FlightNotFound,
    FlightStore,
)
from aicity.settings import SettingsError, load_settings
from aicity.tasks import TaskStore


class _Stop(Exception):
    """A one-line message for the user; exit 2."""


def main(argv=None, *, stdin=sys.stdin, stdout=sys.stdout, stderr=sys.stderr) -> int:
    args = _parser().parse_args(argv)
    try:
        path = db_path(DbKind.PERSONAL)
        if not path.exists():
            raise _Stop("Open the app once first.")
        conn = open_database(path, DbKind.PERSONAL)
        try:
            store = FlightStore(conn, TaskStore(conn, stale_after_days=_stale_days()))
            args.run(store, args, stdin, stdout)
        finally:
            conn.close()
    except (_Stop, FlightError, FlightNotFound, FlightConflict) as exc:
        print(str(exc), file=stderr)
        return 2
    return 0


# --- Commands ----------------------------------------------------------------------


def _save_draft(store: FlightStore, args, stdin, stdout) -> None:
    text = stdin.read().strip()
    if not text:
        raise _Stop("Nothing to save: the text was empty.")
    old = "" if args.replace else store.draft(args.month)
    store.save_draft(args.month, f"{old}\n\n{text}" if old else text)
    print(f"Saved the {args.month} draft.", file=stdout)


def _draft(store: FlightStore, args, stdin, stdout) -> None:
    print(store.draft(args.month), file=stdout)


def _propose(store: FlightStore, args, stdin, stdout) -> None:
    items = validate_proposals(_read_json(args.file))
    store.add_proposals(args.month, items)
    counts: dict[str, int] = {}
    for i in items:
        counts[i["kind"]] = counts.get(i["kind"], 0) + 1
    print("Saved: " + ", ".join(f"{k}: {n}" for k, n in counts.items()), file=stdout)


def _pending(store: FlightStore, args, stdin, stdout) -> None:
    for p in store.pending(args.month):
        print(f"{p['id']} {p['kind']} {json.dumps(p['payload'], ensure_ascii=False)}", file=stdout)


def _decide(store: FlightStore, args, stdin, stdout) -> None:
    payload = None
    if args.action == "edit":
        if args.file is None:
            raise _Stop("An edit needs a JSON file with the edited proposal.")
        payload = _read_json(args.file)
    elif args.file is not None:
        raise _Stop("Only an edit takes a file.")
    store.decide(args.id, args.action, payload)
    print(f"Proposal {args.id}: {args.action}.", file=stdout)


def _status(store: FlightStore, args, stdin, stdout) -> None:
    ready, total = store.coverage()
    if args.month:
        s = store.month_status(args.month)
        state = s["status"] or "not started"
        print(f"{args.month}: {state}, {s['pending']} pending, {s['decided']} decided", file=stdout)
    print(f"Competencies ready: {ready} / {total}", file=stdout)


def _context(store: FlightStore, args, stdin, stdout) -> None:
    print("SKILLS", file=stdout)
    for s in store.skills():
        print(f"- {s['name']} (category {s['category']}, level {s['level']})", file=stdout)
    ready = {e["competency_id"] for e in store.examples() if e["status"] == "ready"}
    print("COMPETENCIES", file=stdout)
    for c in COMPETENCIES:
        mark = "ready" if c.id in ready else "empty"
        print(f"[{mark}] {c.id} {CATEGORIES[c.category]}: {c.name}", file=stdout)
    print("OPEN RECOMMENDATIONS", file=stdout)
    for r in store.recommendations():
        if r["status"] == "open":
            print(f"- {r['skill']}: {r['title']}", file=stdout)
    print("RESUME (section, then item id: text)", file=stdout)
    for s in resume_sections(store.conn):
        print(f"## {s['title']}", file=stdout)
        for item in s["items"]:
            print(f"{item['id']}: {item['text']}", file=stdout)


def _resume_import(store: FlightStore, args, stdin, stdout) -> None:
    sections = preview_import(Path(args.path))
    for s in sections:
        count = len(s.items)
        print(f"{s.title}: {count} item{'' if count == 1 else 's'}", file=stdout)
    if not args.confirm:
        print("Nothing saved. Run again with --confirm to save it.", file=stdout)
        return
    label = confirm_import(store.conn, sections, now=datetime.now(UTC))
    print(f"Saved the resume as {label}.", file=stdout)


def _resume_export(store: FlightStore, args, stdin, stdout) -> None:
    if not resume_imported(store.conn):
        raise _Stop("No resume yet: import one first with resume-import.")
    export_docx(store.conn, Path(args.path))
    print(f"Wrote {args.path}.", file=stdout)


# --- Helpers -----------------------------------------------------------------------


def _read_json(file: str):
    try:
        return json.loads(Path(file).read_text())
    except OSError:
        raise _Stop("That file couldn't be read.") from None
    except ValueError:
        raise _Stop("That file isn't valid JSON.") from None


def _stale_days() -> int:
    try:
        return load_settings().tasks.stale_after_days
    except (SettingsError, OSError):
        return 7


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="flight.py", description="Flight School helper.")
    sub = p.add_subparsers(required=True)

    s = sub.add_parser("save-draft")
    s.add_argument("month")
    s.add_argument("--replace", action="store_true")
    s.set_defaults(run=_save_draft)

    s = sub.add_parser("draft")
    s.add_argument("month")
    s.set_defaults(run=_draft)

    s = sub.add_parser("propose")
    s.add_argument("month")
    s.add_argument("file")
    s.set_defaults(run=_propose)

    s = sub.add_parser("pending")
    s.add_argument("month", nargs="?")
    s.set_defaults(run=_pending)

    s = sub.add_parser("decide")
    s.add_argument("id", type=int)
    s.add_argument("action", choices=["accept", "reject", "edit"])
    s.add_argument("file", nargs="?")
    s.set_defaults(run=_decide)

    s = sub.add_parser("status")
    s.add_argument("month", nargs="?")
    s.set_defaults(run=_status)

    s = sub.add_parser("context")
    s.set_defaults(run=_context)

    s = sub.add_parser("resume-import")
    s.add_argument("path")
    s.add_argument("--confirm", action="store_true")
    s.set_defaults(run=_resume_import)

    s = sub.add_parser("resume-export")
    s.add_argument("path")
    s.set_defaults(run=_resume_export)
    return p


if __name__ == "__main__":
    sys.exit(main())
