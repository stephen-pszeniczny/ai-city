"""Start the Asteroid Belt backend on this Mac.

Run with:  .venv/bin/python scripts/run_app.py
While building the page (with `npm run dev` in frontend/), start it as:
           AICITY_DEV=1 .venv/bin/python scripts/run_app.py

The address comes from src/aicity/config.py (HOST and PORT), the same values
the front door lock checks requests against, so the two can never disagree.

It refuses to start unless HOST is 127.0.0.1: the app is for this Mac only
and must never be reachable from a network. Stop it with Ctrl+C.
"""

import sys
from pathlib import Path

import uvicorn

REPO_ROOT = Path(__file__).resolve().parent.parent
# The app code lives in src/; add it to the path before importing from it.
sys.path.insert(0, str(REPO_ROOT / "src"))

from aicity import config
from aicity.main import create_app
from aicity.sample_data import seed_sample_database

LOOPBACK = "127.0.0.1"


def main() -> None:
    if config.HOST != LOOPBACK:
        raise SystemExit(
            f"Refusing to start: HOST must be {LOOPBACK} (this Mac only). "
            "Check src/aicity/config.py."
        )
    # Made-up tasks for Sample mode, added once (never touches the Personal file).
    if seed_sample_database():
        print("Added made-up tasks to the Sample database.")
    # background=True: the reminder check runs every 30 seconds while the app is up.
    uvicorn.run(create_app(background=True), host=config.HOST, port=config.PORT)


if __name__ == "__main__":
    main()
