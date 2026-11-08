#!/usr/bin/python3
"""Tests for protect-data.py. Run: /usr/bin/python3 .claude/hooks/test_protect_data.py

Feeds fake tool calls to the hook and checks each decision. No file is opened;
paths inside the data folder don't need to exist.
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
HOOK = os.path.join(HERE, "protect-data.py")
PROJECT = os.path.dirname(os.path.dirname(HERE))
DATA = os.path.join(os.path.expanduser("~"), "AI-City-Data")


def run(stdin_text):
    env = dict(os.environ, CLAUDE_PROJECT_DIR=PROJECT)
    out = subprocess.run(["/usr/bin/python3", HOOK], input=stdin_text, env=env,
                         capture_output=True, text=True, timeout=10).stdout.strip()
    return json.loads(out)["hookSpecificOutput"]["permissionDecision"] if out else "allow"


def call(tool, **tool_input):
    return json.dumps({"tool_name": tool, "tool_input": tool_input, "cwd": PROJECT})


CASES = [
    ("Read data-folder file", call("Read", file_path=DATA + "/db/personal.db"), "deny"),
    ("Read data folder via ~", call("Read", file_path="~/AI-City-Data/resume/x.pdf"), "deny"),
    ("Read data folder, other case", call("Read", file_path="~/ai-city-data/x"), "deny"),
    ("Write into data folder", call("Write", file_path=DATA + "/x.txt", content="x"), "deny"),
    ("Grep inside data folder", call("Grep", pattern="x", path=DATA), "deny"),
    ("Glob data folder pattern", call("Glob", pattern="~/AI-City-Data/**/*"), "deny"),
    ("Grep rooted at home", call("Grep", pattern="x", path="~"), "ask"),
    ("Read .env", call("Read", file_path=PROJECT + "/.env"), "deny"),
    ("Edit .env.local", call("Edit", file_path=".env.local", old_string="a", new_string="b"), "deny"),
    ("Read .env.example", call("Read", file_path=PROJECT + "/.env.example"), "allow"),
    ("Edit SPEC.md", call("Edit", file_path=PROJECT + "/SPEC.md", old_string="a", new_string="b"), "ask"),
    ("Read SPEC.md", call("Read", file_path=PROJECT + "/SPEC.md"), "allow"),
    ("Read normal repo file", call("Read", file_path=PROJECT + "/CLAUDE.md"), "allow"),
    ("Grep repo", call("Grep", pattern="x", path=PROJECT), "allow"),
    ("Bash ls ~/AI-City-Data", call("Bash", command="ls ~/AI-City-Data"), "ask"),
    ("Bash cat $HOME/AI-City-Data", call("Bash", command="cat $HOME/AI-City-Data/x"), "ask"),
    ("Bash ${HOME} form", call("Bash", command='cat "${HOME}/AI-City-Data/x"'), "ask"),
    ("Bash cat .env", call("Bash", command="cat .env"), "ask"),
    ("Bash source path/.env.prod", call("Bash", command="source ./cfg/.env.prod && run"), "ask"),
    ("Bash .env.example", call("Bash", command="cp .env.example x"), "allow"),
    ("Bash normal", call("Bash", command="git status"), "allow"),
    ("Malformed JSON", "{not json", "ask"),
    ("Empty input", "", "ask"),
    ("tool_input not an object", json.dumps({"tool_name": "Read", "tool_input": "x"}), "ask"),
    ("Read missing file_path", call("Read"), "ask"),
    ("Unexpected tool", call("Mystery", x=1), "ask"),
]


def main():
    failures = 0
    for name, stdin_text, expected in CASES:
        got = run(stdin_text)
        ok = got == expected
        failures += not ok
        print("%s  %-32s expected %-5s got %s" % ("PASS" if ok else "FAIL", name, expected, got))
    print("\n%d/%d passed" % (len(CASES) - failures, len(CASES)))
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
