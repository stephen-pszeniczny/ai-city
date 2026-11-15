#!/usr/bin/python3
"""Auto-format hook (PostToolUse on Edit, MultiEdit and Write).

After Claude Code edits or writes a file, this tidies its layout with the
project's own pinned formatters:
  - Python (.py, .pyi) anywhere in the repo: `ruff format` from .venv
  - Frontend files (.ts .tsx .js .jsx .css .json .html) under frontend/:
    `prettier --write` from frontend/node_modules (uses .prettierrc.json)

Layout only: no lint fixes, so nothing is ever deleted from the code.
Skipped: anything outside the repo (links are resolved first), .venv,
node_modules, dist, .git, SPEC.md and .env files.

Never blocks an edit: any problem prints a one-line warning and exits 0.
No network access. Tests: /usr/bin/python3 .claude/hooks/test_format_file.py
"""

import json
import os
import subprocess
import sys

PROJECT = os.path.realpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
FRONTEND = os.path.join(PROJECT, "frontend")
RUFF = os.path.join(PROJECT, ".venv", "bin", "ruff")
PRETTIER = os.path.join(FRONTEND, "node_modules", ".bin", "prettier")

TOOLS = {"Edit", "MultiEdit", "Write"}
PY_EXT = {".py", ".pyi"}
FRONT_EXT = {".ts", ".tsx", ".js", ".jsx", ".css", ".json", ".html"}
SKIP_DIRS = {".venv", "node_modules", "dist", ".git"}
TIMEOUT = 30


def warn(msg):
    print("format-file: " + msg, file=sys.stderr)


def target_path(event):
    """The real path of the edited file, or None if it shouldn't be formatted."""
    if event.get("tool_name") not in TOOLS:
        return None
    raw = (event.get("tool_input") or {}).get("file_path")
    if not isinstance(raw, str) or not raw:
        return None
    path = os.path.expanduser(raw)
    if not os.path.isabs(path):
        path = os.path.join(event.get("cwd") or PROJECT, path)
    real = os.path.realpath(path)  # follows links, so a link can't lead outside
    if not real.startswith(PROJECT + os.sep) or not os.path.isfile(real):
        return None
    parts = os.path.relpath(real, PROJECT).split(os.sep)
    name = parts[-1]
    if SKIP_DIRS.intersection(parts[:-1]) or name == "SPEC.md" or name.startswith(".env"):
        return None
    return real


def command_for(path):
    """The formatter command and folder to run it from, or None."""
    ext = os.path.splitext(path)[1].lower()
    if ext in PY_EXT:
        return [RUFF, "format", "--quiet", path], PROJECT
    if ext in FRONT_EXT and path.startswith(FRONTEND + os.sep):
        return [PRETTIER, "--write", "--log-level", "warn", path], FRONTEND
    return None


def main():
    try:
        event = json.loads(sys.stdin.read() or "{}")
        path = target_path(event) if isinstance(event, dict) else None
        job = command_for(path) if path else None
        if not job:
            return
        cmd, cwd = job
        if not os.path.exists(cmd[0]):
            warn("formatter not installed: " + os.path.relpath(cmd[0], PROJECT))
            return
        result = subprocess.run(
            cmd, check=False, cwd=cwd, capture_output=True, text=True, timeout=TIMEOUT
        )
        if result.returncode != 0:
            warn("could not format " + os.path.relpath(path, PROJECT) + " (left as written)")
    except Exception as exc:  # noqa: BLE001 (never block an edit)
        warn("skipped (" + type(exc).__name__ + ")")


if __name__ == "__main__":
    main()
    sys.exit(0)
