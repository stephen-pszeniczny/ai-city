"""Blocked-words check: stop personal words from reaching the public repo.

Reads a private word list from <data folder>/blocked_words.txt (one word or
phrase per line; blank lines and lines starting with # are ignored) and checks:
  - every line being added in the staged changes,
  - the names of staged files,
  - the commit message (when run with --message FILE from the commit-msg hook).

Matching ignores capitals and only matches whole words, where only letters
count as part of a word: "foo" matches "Foo", "foo_bar", "foo2" and "foo.com",
but not "football". Phrases match with any spacing between their words.

Privacy: a match is reported by file name and line number only. The word and
the line's text are never printed, and a file name that itself contains a
blocked word is hidden too.

Exit codes: 0 = clean, 1 = blocked word found, 2 = list missing or empty.
Standard library only, so it runs before any project setup.
"""

import os
import re
import subprocess
import sys
from pathlib import Path

LIST_NAME = "blocked_words.txt"
LETTER = r"[^\W\d_]"  # any letter, in any alphabet
HIDDEN_NAME = "<file name contains a blocked word>"


class ListError(Exception):
    """The word list is missing or has no words."""


def data_dir() -> Path:
    """Same rule as the app (src/aicity/config.py): AICITY_DATA_DIR, else ~/AI-City-Data."""
    raw = os.environ.get("AICITY_DATA_DIR", "").strip()
    path = Path(raw).expanduser() if raw else Path.home() / "AI-City-Data"
    return path.resolve()


def list_path() -> Path:
    return data_dir() / LIST_NAME


def load_words(path: Path) -> list[str]:
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise ListError(f"Blocked-words list not found at {path}.") from None
    words = [line.strip() for line in text.splitlines()]
    words = [w for w in words if w and not w.startswith("#")]
    if not words:
        raise ListError(f"Blocked-words list at {path} has no words in it.")
    return words


def build_pattern(words: list[str]) -> re.Pattern[str]:
    """One pattern for all words: whole words only, any capitals, flexible spacing."""
    bodies = sorted((r"\s+".join(map(re.escape, w.split())) for w in words), key=len, reverse=True)
    return re.compile(rf"(?<!{LETTER})(?:{'|'.join(bodies)})(?!{LETTER})", re.IGNORECASE)


def added_lines(diff: str):
    """Yield (file, line number, text) for every added line in a `git diff -U0` output."""
    path, line_no, in_header = None, 0, False
    for raw in diff.splitlines():
        if raw.startswith("diff --git "):
            in_header, path = True, None
        elif in_header and raw.startswith("+++ "):
            target = raw[4:].rstrip("\t")  # git adds a tab after names with spaces
            path = target[2:] if target.startswith("b/") else None  # None for /dev/null
        elif raw.startswith("@@"):
            in_header = False
            m = re.match(r"@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@", raw)
            line_no = int(m[1]) if m else 0
        elif not in_header and raw.startswith("+") and path is not None:
            # Inside a hunk, so even a line starting "+++" is added content.
            yield path, line_no, raw[1:]
            line_no += 1


def _git(*args: str) -> str:
    result = subprocess.run(
        ["git", "-c", "core.quotePath=false", *args],
        capture_output=True,
        check=True,
    )
    return result.stdout.decode("utf-8", errors="replace")


def staged_diff() -> str:
    return _git(
        "diff", "--cached", "--no-color", "--no-ext-diff", "-U0",
        "--src-prefix=a/", "--dst-prefix=b/",
    )  # fmt: skip


def staged_names() -> list[str]:
    out = _git("diff", "--cached", "--name-only", "--diff-filter=ACR", "-z")
    return [n for n in out.split("\0") if n]


def find_in_staged(pattern: re.Pattern[str], diff: str, names: list[str]) -> list[str]:
    """Where blocked words appear in staged changes, as safe-to-print locations."""

    def shown(name: str) -> str:
        return HIDDEN_NAME if pattern.search(name) else name

    found = [f"{shown(n)} (in the file name)" for n in names if pattern.search(n)]
    found += [f"{shown(p)}:{n}" for p, n, text in added_lines(diff) if pattern.search(text)]
    return found


def find_in_message(pattern: re.Pattern[str], message: str) -> list[str]:
    """Lines starting with # are git's own comments and are removed from the message."""
    return [
        f"commit message, line {i}"
        for i, line in enumerate(message.splitlines(), start=1)
        if not line.startswith("#") and pattern.search(line)
    ]


def main(argv: list[str]) -> int:
    try:
        pattern = build_pattern(load_words(list_path()))
    except ListError as exc:
        print(f"{exc}\nCommit blocked: the blocked-words check can't run without it.")
        return 2

    if len(argv) == 2 and argv[0] == "--message":
        found = find_in_message(pattern, Path(argv[1]).read_text(encoding="utf-8"))
    else:
        found = find_in_staged(pattern, staged_diff(), staged_names())

    if not found:
        return 0
    print("Commit blocked: a word from your blocked-words list appears here:")
    for place in found:
        print(f"  {place}")
    print("The word itself isn't shown. Remove or reword it, then commit again.")
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
