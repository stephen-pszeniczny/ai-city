#!/usr/bin/python3
"""Claude Code PreToolUse hook: keep Claude out of private data.

Reads one tool call (JSON) on stdin and prints a permission decision:
  deny  - Read/Edit/Write/NotebookEdit/Grep/Glob on ~/AI-City-Data or a .env file
  ask   - Edit/Write of the private spec, Bash commands that mention the data
          folder or a .env file, searches rooted above the data folder
  (no output) - everything else; the normal permission flow applies

Fails closed: any error or unexpected input returns "ask", never a silent allow.
Standard library only; runs on the macOS system Python (3.9).
"""
import json
import os
import re
import sys

HOME = os.path.expanduser("~")
DATA_DIR = os.path.realpath(os.path.join(HOME, "AI-City-Data")).lower()
FILE_TOOLS = {"Read", "Edit", "MultiEdit", "Write", "NotebookEdit"}
WRITE_TOOLS = {"Edit", "MultiEdit", "Write", "NotebookEdit"}
SEARCH_TOOLS = {"Grep", "Glob"}
# A .env or .env.<suffix> token in a shell command (.env.example is allowed).
BASH_ENV_RE = re.compile(r"""(?:^|[\s/'"=<>])(\.env(?:\.[\w.-]+)?)(?=$|[\s'";|&)<>])""")


def decide(decision, reason):
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": decision,
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)


def resolve(path, cwd):
    """Absolute, symlink-resolved, lower-cased path (macOS disks are case-insensitive)."""
    path = os.path.expandvars(os.path.expanduser(path))
    if not os.path.isabs(path):
        path = os.path.join(cwd, path)
    return os.path.realpath(path).lower()


def in_data(resolved):
    return resolved == DATA_DIR or resolved.startswith(DATA_DIR + os.sep)


def is_env(resolved):
    name = os.path.basename(resolved)
    return name == ".env" or (name.startswith(".env.") and name != ".env.example")


def require_str(tool_input, key):
    value = tool_input.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError("missing or invalid '%s'" % key)
    return value


def check(call):
    tool = call.get("tool_name")
    tool_input = call.get("tool_input")
    if not isinstance(tool, str) or not isinstance(tool_input, dict):
        raise ValueError("unexpected tool call shape")
    cwd = call.get("cwd") or os.getcwd()
    project = os.environ.get("CLAUDE_PROJECT_DIR") or cwd
    spec = os.path.realpath(os.path.join(project, "SPEC.md")).lower()

    if tool in FILE_TOOLS:
        key = "notebook_path" if tool == "NotebookEdit" else "file_path"
        target = resolve(require_str(tool_input, key), cwd)
        if in_data(target):
            decide("deny", "Blocked: ~/AI-City-Data is private app data and off-limits to Claude.")
        if is_env(target):
            decide("deny", "Blocked: .env files may hold secrets and are off-limits to Claude.")
        if tool in WRITE_TOOLS and target == spec:
            decide("ask", "SPEC.md is the private source of truth. Confirm this edit.")
        return

    if tool in SEARCH_TOOLS:
        root = resolve(tool_input.get("path") or cwd, cwd)
        patterns = " ".join(str(tool_input.get(k) or "") for k in ("pattern", "glob")).lower()
        if in_data(root) or "ai-city-data" in patterns:
            decide("deny", "Blocked: searching ~/AI-City-Data is off-limits to Claude.")
        if DATA_DIR.startswith(root + os.sep):
            decide("ask", "This search covers a folder that contains ~/AI-City-Data. Confirm.")
        return

    if tool == "Bash":
        command = require_str(tool_input, "command")
        if "ai-city-data" in command.lower():
            decide("ask", "This command mentions the private data folder. Confirm before it runs.")
        for match in BASH_ENV_RE.finditer(command):
            if match.group(1) != ".env.example":
                decide("ask", "This command mentions a .env file. Confirm before it runs.")
        return

    raise ValueError("unhandled tool '%s'" % tool)


def main():
    try:
        check(json.loads(sys.stdin.read()))
    except SystemExit:
        raise
    except Exception as exc:  # fail closed
        decide("ask", "Data-protection hook could not check this call (%s). Confirm." % exc)


if __name__ == "__main__":
    main()
