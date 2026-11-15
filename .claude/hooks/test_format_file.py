#!/usr/bin/python3
"""Tests for format-file.py. Run: /usr/bin/python3 .claude/hooks/test_format_file.py

Writes small badly-formatted files into temporary folders (inside and outside the
repo), feeds the hook a fake Edit/Write call for each, and checks whether the file
was reformatted or left alone. Every temporary folder is deleted afterwards.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
HOOK = os.path.join(HERE, "format-file.py")
PROJECT = os.path.dirname(os.path.dirname(HERE))
FRONTEND = os.path.join(PROJECT, "frontend")

MESSY_PY = "x   =  {'a':1}\n"
CLEAN_PY = 'x = {"a": 1}\n'
MESSY_TS = "const   a = {b:1}\n"
CLEAN_TS = "const a = { b: 1 };\n"
BROKEN_PY = "def (:\n"


def run(stdin_text):
    return subprocess.run(
        ["/usr/bin/python3", HOOK],
        check=False,
        input=stdin_text,
        capture_output=True,
        text=True,
        timeout=60,
    )


def call(tool, path):
    return json.dumps({"tool_name": tool, "tool_input": {"file_path": path}, "cwd": PROJECT})


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        f.write(text)


def read(path):
    with open(path) as f:
        return f.read()


def main():
    tag = f".fmt-test-{os.getpid()}"
    repo_tmp = os.path.join(PROJECT, tag)
    front_tmp = os.path.join(FRONTEND, tag)
    venv_tmp = os.path.join(PROJECT, ".venv", tag)
    nm_tmp = os.path.join(FRONTEND, "node_modules", tag)
    outside = tempfile.mkdtemp()
    cleanup = [repo_tmp, front_tmp, venv_tmp, nm_tmp, outside]

    # (name, tool, path, starting text, expected text after, expect exit 0)
    cases = [
        ("Python in repo is formatted", "Edit", os.path.join(repo_tmp, "a.py"), MESSY_PY, CLEAN_PY),
        ("Write tool also formats", "Write", os.path.join(repo_tmp, "b.py"), MESSY_PY, CLEAN_PY),
        (
            "TS in frontend is formatted",
            "Edit",
            os.path.join(front_tmp, "a.ts"),
            MESSY_TS,
            CLEAN_TS,
        ),
        (
            "TSX in frontend is formatted",
            "Write",
            os.path.join(front_tmp, "a.tsx"),
            MESSY_TS,
            CLEAN_TS,
        ),
        (
            "Python outside repo untouched",
            "Edit",
            os.path.join(outside, "a.py"),
            MESSY_PY,
            MESSY_PY,
        ),
        (
            "TS outside frontend untouched",
            "Edit",
            os.path.join(repo_tmp, "c.ts"),
            MESSY_TS,
            MESSY_TS,
        ),
        ("Python in .venv untouched", "Edit", os.path.join(venv_tmp, "a.py"), MESSY_PY, MESSY_PY),
        ("TS in node_modules untouched", "Edit", os.path.join(nm_tmp, "a.ts"), MESSY_TS, MESSY_TS),
        ("Markdown untouched", "Edit", os.path.join(repo_tmp, "a.md"), MESSY_PY, MESSY_PY),
        ("Shell tool ignored", "Bash", os.path.join(repo_tmp, "d.py"), MESSY_PY, MESSY_PY),
        ("Broken Python left as is", "Edit", os.path.join(repo_tmp, "e.py"), BROKEN_PY, BROKEN_PY),
    ]

    failures = 0
    try:
        for name, tool, path, start, expected in cases:
            write(path, start)
            result = run(call(tool, path))
            ok = result.returncode == 0 and read(path) == expected
            failures += not ok
            print(f"{'ok  ' if ok else 'FAIL'}  {name}")
            if not ok:
                print(f"      exit={result.returncode} got={read(path)!r} stderr={result.stderr!r}")

        # A link inside the repo that points outside must not be followed.
        target = os.path.join(outside, "target.py")
        write(target, MESSY_PY)
        link = os.path.join(repo_tmp, "link.py")
        os.symlink(target, link)
        result = run(call("Edit", link))
        ok = result.returncode == 0 and read(target) == MESSY_PY
        failures += not ok
        print(f"{'ok  ' if ok else 'FAIL'}  Link pointing outside repo not followed")

        # Bad input never blocks: always exit 0.
        for name, stdin_text in [
            ("Garbage input exits 0", "not json"),
            ("Empty input exits 0", ""),
            ("Missing file_path exits 0", json.dumps({"tool_name": "Edit", "tool_input": {}})),
            ("Missing file exits 0", call("Edit", os.path.join(repo_tmp, "nope.py"))),
        ]:
            ok = run(stdin_text).returncode == 0
            failures += not ok
            print(f"{'ok  ' if ok else 'FAIL'}  {name}")
    finally:
        for d in cleanup:
            shutil.rmtree(d, ignore_errors=True)

    print(f"\n{failures} failure(s)")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
