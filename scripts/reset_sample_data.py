"""Throw away the Sample database and make it again with fresh made-up tasks.

Run with:  .venv/bin/python scripts/reset_sample_data.py

Handy before recording a demo or taking screenshots. It asks you to type
"reset" first. Only the file labelled Sample is ever deleted: the label is
checked before anything happens, and your Personal database is never opened.
Safe to run while the app is running; the to-do list shows the fresh tasks
on its next refresh.
"""

import sys
from collections.abc import Callable
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
# The app code lives in src/; add it to the path before importing from it.
sys.path.insert(0, str(REPO_ROOT / "src"))

from aicity.db import DatabaseError, DbKind, db_path
from aicity.sample_data import SAMPLE_TASKS, reset_sample_database

CONFIRM_WORD = "reset"


def main(ask: Callable[[str], str] = input) -> int:
    print(f"This deletes the Sample database:\n  {db_path(DbKind.SAMPLE)}")
    print("and fills it again with made-up tasks. Your Personal database isn't touched.")
    if ask(f'Type "{CONFIRM_WORD}" to go ahead: ').strip() != CONFIRM_WORD:
        print("Nothing changed.")
        return 1
    try:
        reset_sample_database()
    except DatabaseError as e:
        print(f"Stopped: {e}")
        return 2
    print(f"Done. The Sample database now has {len(SAMPLE_TASKS)} fresh made-up tasks.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
