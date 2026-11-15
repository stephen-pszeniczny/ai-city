"""Tests for the blocked-words commit check (.githooks/blocked_words.py).

Only invented words are used, in word lists written to temp folders. The
real list is never opened: every run sets AICITY_DATA_DIR to a temp folder.
"""

import importlib.util
import os
import subprocess
import sys
from pathlib import Path

import pytest

from aicity import config

SCRIPT = Path(__file__).resolve().parent.parent / ".githooks" / "blocked_words.py"
_spec = importlib.util.spec_from_file_location("blocked_words", SCRIPT)
bw = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bw)

FAKE_LIST = """\
# Invented words for tests only
zorblax

   quuxcorp
secret   project
  # an indented comment
c++
"""


def pattern(*words):
    return bw.build_pattern(list(words))


# --- Reading the list ------------------------------------------------------


def test_list_skips_blank_lines_and_comments(tmp_path):
    f = tmp_path / "blocked_words.txt"
    f.write_text(FAKE_LIST)
    assert bw.load_words(f) == ["zorblax", "quuxcorp", "secret   project", "c++"]


def test_missing_list_is_an_error(tmp_path):
    with pytest.raises(bw.ListError, match="not found"):
        bw.load_words(tmp_path / "blocked_words.txt")


def test_list_with_only_comments_is_an_error(tmp_path):
    f = tmp_path / "blocked_words.txt"
    f.write_text("# nothing here\n\n   \n# still nothing\n")
    with pytest.raises(bw.ListError, match="no words"):
        bw.load_words(f)


def test_list_location_follows_the_app_rule(monkeypatch, tmp_path):
    for value in [str(tmp_path / "x"), "~/y", ""]:
        monkeypatch.setenv("HOME", str(tmp_path))
        monkeypatch.setenv("AICITY_DATA_DIR", value)
        assert bw.data_dir() == config.data_dir()
    assert bw.list_path() == config.data_dir() / "blocked_words.txt"


# --- Matching --------------------------------------------------------------


@pytest.mark.parametrize(
    "text",
    [
        "zorblax",
        "Zorblax",
        "ZORBLAX said hi",
        "the zorblax.",
        "(zorblax)",
        "zorblax_client",  # code glues words with _
        "my-zorblax-notes",
        "zorblax2",
        "zorblax.com",
        "x='zorblax'",
    ],
)
def test_matches_whole_word_any_capitals(text):
    assert pattern("zorblax").search(text)


@pytest.mark.parametrize("text", ["zorblaxian", "unzorblax", "zorblaxes", "azorblaxb", ""])
def test_does_not_match_inside_other_words(text):
    assert not pattern("zorblax").search(text)


@pytest.mark.parametrize(
    "text", ["secret project", "Secret  Project", "a secret\tproject here", "SECRET PROJECT"]
)
def test_phrases_match_with_any_spacing(text):
    assert pattern("secret project").search(text)


@pytest.mark.parametrize("text", ["secretproject", "secret projects", "the secret"])
def test_phrases_need_their_whole_words(text):
    assert not pattern("secret project").search(text)


def test_symbols_in_words_are_taken_literally():
    p = pattern("c++", "a.b")
    assert p.search("I write C++ daily")
    assert p.search("a.b")
    assert not p.search("axb")  # '.' isn't a wildcard


def test_other_alphabets_count_as_letters():
    p = pattern("café")
    assert p.search("Café time")
    assert not p.search("cafés")


# --- Reading git's staged changes -------------------------------------------

SAMPLE_DIFF = """\
diff --git a/notes.txt b/notes.txt
index 1111111..2222222 100644
--- a/notes.txt
+++ b/notes.txt
@@ -2,0 +3,2 @@ heading
+first added
+second added
@@ -10 +12 @@
-old line
+replaced line
diff --git a/my file.md b/my file.md
new file mode 100644
--- /dev/null
+++ b/my file.md\t
@@ -0,0 +1,2 @@
+++ looks like a header but is content
+last
\\ No newline at end of file
diff --git a/gone.txt b/gone.txt
deleted file mode 100644
--- a/gone.txt
+++ /dev/null
@@ -1 +0,0 @@
-zorblax was here
"""


def test_added_lines_have_correct_files_and_line_numbers():
    assert list(bw.added_lines(SAMPLE_DIFF)) == [
        ("notes.txt", 3, "first added"),
        ("notes.txt", 4, "second added"),
        ("notes.txt", 12, "replaced line"),
        ("my file.md", 1, "++ looks like a header but is content"),
        ("my file.md", 2, "last"),
    ]


def test_deleted_lines_are_not_checked():
    assert bw.find_in_staged(pattern("zorblax"), SAMPLE_DIFF, []) == []


def test_file_name_with_blocked_word_is_reported_but_hidden():
    found = bw.find_in_staged(pattern("zorblax"), "", ["docs/zorblax-plan.md"])
    assert found == ["<file name contains a blocked word> (in the file name)"]


def test_commit_message_skips_git_comment_lines():
    msg = "Add feature\n\nWorks with Zorblax now\n# zorblax in a git comment is removed\n"
    assert bw.find_in_message(pattern("zorblax"), msg) == ["commit message, line 3"]


# --- The whole check, run the way the git hook runs it -----------------------


def run_check(repo: Path, data: Path, *args: str) -> subprocess.CompletedProcess:
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env["AICITY_DATA_DIR"] = str(data)
    return subprocess.run(
        [sys.executable, "-I", str(SCRIPT), *args],
        cwd=repo,
        env=env,
        capture_output=True,
        text=True,
        check=False,
        timeout=60,
    )


@pytest.fixture
def repo(tmp_path):
    r = tmp_path / "repo"
    r.mkdir()
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=r, check=True, env=env)
    return r


@pytest.fixture
def data(tmp_path):
    d = tmp_path / "data"
    d.mkdir()
    (d / "blocked_words.txt").write_text(FAKE_LIST)
    return d


def stage(repo: Path, name: str, text: str) -> None:
    f = repo / name
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(text)
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    subprocess.run(["git", "add", name], cwd=repo, check=True, env=env)


def test_clean_commit_passes(repo, data):
    stage(repo, "readme.md", "Nothing private here.\nFootball results.\n")
    assert run_check(repo, data).returncode == 0


def test_blocked_word_stops_commit_and_shows_only_location(repo, data):
    stage(repo, "notes.txt", "line one\nline two\nWe met QuuxCorp today\nzorblaxian is fine\n")
    result = run_check(repo, data)
    out = result.stdout + result.stderr
    assert result.returncode == 1
    assert "notes.txt:3" in out
    assert "notes.txt:4" not in out
    for secret in ["quuxcorp", "met", "today"]:
        assert secret not in out.lower()


def test_hidden_file_name_never_printed(repo, data):
    stage(repo, "zorblax/plan.txt", "harmless\n")
    out = run_check(repo, data).stdout
    assert "zorblax" not in out.lower()
    assert "<file name contains a blocked word>" in out


def test_missing_list_blocks_commit(repo, tmp_path):
    stage(repo, "readme.md", "hello\n")
    empty_data = tmp_path / "no-list-here"
    empty_data.mkdir()
    result = run_check(repo, empty_data)
    assert result.returncode == 2
    assert "not found" in result.stdout


def test_commit_message_check(repo, data, tmp_path):
    msg = tmp_path / "COMMIT_EDITMSG"
    msg.write_text("Tidy up\n\nFor the Secret Project launch\n")
    result = run_check(repo, data, "--message", str(msg))
    assert result.returncode == 1
    assert "commit message, line 3" in result.stdout
    assert "secret" not in result.stdout.lower()

    msg.write_text("Tidy up\n\nNothing to see\n")
    assert run_check(repo, data, "--message", str(msg)).returncode == 0
