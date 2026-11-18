"""Compile the Touch ID helper the Personal / Sample switch uses. Safe to re-run.

Run with:  .venv/bin/python scripts/build_touch_id_helper.py

It compiles helpers/confirm_owner.swift with the Swift compiler that comes
with Apple's Command Line Tools, into build/confirm-owner (git-ignored).
Nothing is downloaded. Re-run it after changing the Swift file.
"""

import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SOURCE = REPO_ROOT / "helpers" / "confirm_owner.swift"
OUTPUT = REPO_ROOT / "build" / "confirm-owner"


def main() -> None:
    if sys.platform != "darwin":
        sys.exit("The Touch ID helper only builds on a Mac.")
    swiftc = shutil.which("swiftc")
    if swiftc is None:
        sys.exit("Swift compiler not found. Install Apple's Command Line Tools first.")

    OUTPUT.parent.mkdir(exist_ok=True)
    subprocess.run([swiftc, "-O", str(SOURCE), "-o", str(OUTPUT)], check=True)
    OUTPUT.chmod(0o755)
    print(
        f"Built {OUTPUT.relative_to(REPO_ROOT)}. Switching to Personal will now ask for Touch ID."
    )


if __name__ == "__main__":
    main()
