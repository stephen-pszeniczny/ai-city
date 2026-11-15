"""Set up the private data folder. Safe to run any number of times.

Run with:  .venv/bin/python scripts/init_data_dir.py

What it does:
  - creates the data folder (default ~/AI-City-Data, or AICITY_DATA_DIR) and
    its subfolders, readable by this Mac account only;
  - copies settings.example.toml to settings/settings.toml, but ONLY if no
    settings file exists yet (your settings are never overwritten);
  - checks the settings file loads;
  - reports whether the blocked-words list exists (without reading it).

It refuses to use a data folder inside this code repo, so personal data can
never end up somewhere git could commit it.
"""

import os
import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
# The app code lives in src/; add it to the path before importing from it.
sys.path.insert(0, str(REPO_ROOT / "src"))

from aicity import config
from aicity.settings import SettingsError, load_settings, settings_path

SUBFOLDERS = ("db", "imports", "settings", "resume", "exports", "backups", "logs")
EXAMPLE = REPO_ROOT / "settings.example.toml"
BLOCKED_WORDS = "blocked_words.txt"


class SetupError(Exception):
    """Setup can't continue safely. The message says why."""


def make_private_dir(path: Path) -> bool:
    """Create path (owner-only) if missing; tighten it if others have access. True if created."""
    created = not path.exists()
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.stat().st_mode & 0o077:
        os.chmod(path, 0o700)
    return created


def init_data_dir(data: Path, repo_root: Path = REPO_ROOT) -> list[str]:
    """Set up the data folder at `data`. Returns plain-language lines describing what happened."""
    data = data.resolve()
    if data.is_relative_to(repo_root.resolve()):
        raise SetupError(
            f"Refusing to set up a data folder inside the code repo ({data}). "
            "Personal data must live outside it. Unset AICITY_DATA_DIR or point it elsewhere."
        )

    report = []
    report.append(("Created" if make_private_dir(data) else "Found") + f" data folder: {data}")
    for name in SUBFOLDERS:
        if make_private_dir(data / name):
            report.append(f"Created {name}/")

    target = data / "settings" / "settings.toml"
    if target.exists():
        report.append("Settings file already exists, left untouched.")
    else:
        shutil.copyfile(EXAMPLE, target)
        os.chmod(target, 0o600)
        report.append(
            "Copied the example settings to settings/settings.toml. Fill in your details."
        )

    try:
        load_settings(target)
        report.append("Settings file loads correctly.")
    except SettingsError as exc:
        report.append(f"Settings file has a problem: {exc}")

    words = data / BLOCKED_WORDS
    report.append(
        "Blocked-words list: present."
        if words.is_file()
        else f"Blocked-words list: MISSING. Create {words} or commits will be blocked."
    )
    return report


def main() -> int:
    data = config.data_dir()
    try:
        lines = init_data_dir(data)
    except SetupError as exc:
        print(exc)
        return 1
    print("\n".join(lines))
    print(f"\nNext: open your settings with\n  open -e {settings_path()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
