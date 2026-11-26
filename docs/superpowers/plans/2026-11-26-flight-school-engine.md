# Flight School engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flight School's engine, usable from Claude Code before any screens exist: settings, the competency list, the data, the store that applies approved proposals, the monthly to-do, the helper command and `/flight-log` skill, the master resume with Word import and export, and the local-model path.

**Architecture:** Three PRs. **PR 1 (Tasks 1–5):** `[career]` settings, the competency reference list, migration 016, `flight_store.py`, and the monthly to-do from the reminder loop. **PR 2 (Tasks 6–8):** the proposals schema, `scripts/flight.py` (save-draft, draft, propose, pending, decide, status) and the project skill `.claude/skills/flight-log/`. **PR 3 (Tasks 9–10):** the master resume (sections, versions, Word import and export with `python-docx`) and the local-model analysis through Ollama. Routes, the Touch ID lock, Sample data and screens come after the computer overhaul.

**Tech Stack:** Python 3.13, SQLite, pytest; `python-docx` (PR 3, after the owner approves it); Ollama's local HTTP API (PR 3).

**Spec:** `docs/superpowers/specs/2026-11-26-flight-school-design.md` (public) and SPEC.md section 8, Flight School (private).

## Global Constraints

- Public repo: example values only. Never name the employer or the licensing body in tracked files (the blocked-words hook enforces this); say "main job" and "the engineering regulator".
- Main-job content stays general (spec section 5): the store never adds text the owner didn't approve; the skill and the local prompt forbid names, documents, identifiers and meeting details.
- Every proposal is applied only when the owner accepts or edits it. Nothing is sent, published or bought.
- Photos are never stored; only text reaches the database.
- Rows are never hard-deleted (never-delete triggers). STRICT tables. Strict settings parsing; `[career]` is optional.
- Level is a whole number 1–5. Study target starts at 0 minutes per week. Reminder day 1–28 (default 1).
- No network in the engine except the local-model call to `http://127.0.0.1:11434` (PR 3). No new dependency without the owner's yes (`python-docx`, pinned).
- Run `ruff format` and `ruff check` before each commit; chain `ruff check && git commit`.

## Decisions made here

- **Competency ids** are the regulator's numbers as text (`"1.1"`…), category 1–7 is the part before the dot. Each example's limits: situation, action, outcome in characters, stored as constants with the source document and date. Values come from the official guide (Task 2).
- **Proposal kinds and payloads** (JSON, validated in Task 6):
  - `bullet`: `{text ≤ 300, skills: [names], competencies: [ids]}`
  - `example`: `{competency: id, situation, action, outcome}` within the limits
  - `new_skill`: `{name ≤ 60, category 1–7, level 1–5, related: [names], competencies: [ids]}`
  - `level_change`: `{skill: name, to: 1–5, evidence: text ≤ 300}`
  - `recommendation`: `{skill: name, kind: task|course, title ≤ 120, provider ≤ 60, url (https) | null, price ≤ 40, free: bool}`
  - `resume_change`: `{section ≤ 60, action: add|replace|remove, item: id | null, text ≤ 300}`
- **Deciding:** `accept` applies the payload as is; `edit` applies an owner-edited payload (validated again); `reject` applies nothing. Accepted examples are `ready`.
- **A month is done** when it has at least one decided proposal and none pending. Then, in one transaction: the progress row is saved, the resume version bumps if any resume change was accepted that month, and the month's to-do is completed.
- **Resume version label:** `v{N} {Mon YYYY}` from the done month (`v5 Nov 2026`).
- **Monthly to-do:** from `reminder_day` at `tasks.reminder_time`, if last month isn't done and has no to-do yet, create one Mission Control task: title `Log last month for Flight School`, category `personal`, notes `Run /flight-log in Claude Code.`, reminder at that moment (so the existing task reminder brings the shuttle and Mac notification). Linked from `fs_months.todo_task_id`, so it's never made twice.
- **Helper safety:** `scripts/flight.py` works only on the Personal database through `open_database` (never creates it) and prints nothing but the requested data.

## Review Focus

1. **A proposals file with a payload that breaks a limit** (example over the action limit, level 7, unknown competency, http URL) is refused whole with a clear message naming the item, and nothing is saved. Test in Task 6.
2. **Deciding the same proposal twice** (accept then accept, or accept then reject) is refused; applying never happens twice. Test in Task 4.
3. **A level change or recommendation for a skill that doesn't exist yet**, in the same batch as the `new_skill` that creates it, works when the new skill is accepted first and is refused with a clear message otherwise. Test in Task 4.
4. **The monthly to-do when the app was closed on the 1st** appears at the next check that month, once; finishing the month completes it; a month already done never gets one. Test in Task 5.
5. **A Word resume with odd structure** (no headings, tables, empty paragraphs) imports into a reviewable preview without crashing, and nothing is saved until confirmed. Test in Task 9.

---

## PR 1: data

### Task 1: `[career]` settings

**Files:** Create `src/aicity/career_settings.py`; Modify `src/aicity/settings.py` (allow and parse `career`), `settings.example.toml`; Test `tests/test_career_settings.py`

**Interfaces:**
- `AI_MODES = ("claude_code", "local")`
- `@dataclass(frozen=True) class CareerSettings: ai: str; local_model: str | None; reminder_day: int`
- `def parse_career(t: dict) -> CareerSettings` (defaults `ai="claude_code"`, `local_model=None`, `reminder_day=1`; `local_model` 1–80 chars, required when `ai="local"`); `Settings.career: CareerSettings | None = None`.

- [ ] **Step 1: Failing tests:** `test_career_is_optional`; `test_defaults`; `test_local_needs_a_model`; parametrised `test_refuses` (unknown ai, reminder_day 0 and 29, unknown key, empty model).
- [ ] **Step 2–4:** fail; implement reusing `_only_keys` from `settings.py`; commented example block in `settings.example.toml`; pass with the settings suite.
- [ ] **Step 5: Commit** `Settings: Flight School`

### Task 2: The competency list

**Files:** Create `src/aicity/competencies.py`; Test `tests/test_competencies.py`

**Interfaces:** `@dataclass(frozen=True) class Competency: id: str; category: int; name: str`; `CATEGORIES: dict[int, str]` (7); `COMPETENCIES: tuple[Competency, ...]` (34, in the regulator's order); `LIMITS = {"situation": int, "action": int, "outcome": int}`; `SOURCE = "…guide name, edition date"`; `def competency(id: str) -> Competency` (raises `KeyError`).

- [ ] **Step 1: Get the data:** extract the categories, the 34 competencies and the current limits from the regulator's official competency-based assessment guide and application form (needs a PDF text tool; see the owner's decision). Never guess a name.
- [ ] **Step 2: Failing tests:** 7 categories numbered 1–7; exactly 34 competencies with unique ids, each id's category matching its prefix; every category has at least one; `LIMITS` keys exactly the three; `competency("9.9")` raises.
- [ ] **Step 3–4:** implement, with a header comment naming the source and date (no URL containing a blocked word); pass.
- [ ] **Step 5: Commit** `Flight School: the competency list`

### Task 3: Migration 016

**Files:** Create `src/aicity/migrations/016_flight_school.sql`; Test `tests/test_flight_schema.py`

**Interfaces (STRICT; UTC stamps with the 013-style CHECK; months `YYYY-MM`; dates `YYYY-MM-DD`):**
- `fs_months(month PRIMARY KEY, draft TEXT NOT NULL DEFAULT '' ≤ 20000, status IN ('draft','proposed','done'), todo_task_id INTEGER NULL REFERENCES tasks, updated_at, done_at NULL)`
- `fs_proposals(id, month REFERENCES fs_months, kind IN (the six), payload_json (json_valid), status IN ('pending','accepted','edited','rejected'), decided_at NULL, created_at)`; CHECK `(status = 'pending') = (decided_at IS NULL)`
- `fs_bullets(id, month, text 1–300, links_json, proposal_id REFERENCES fs_proposals)`
- `fs_examples(id, competency_id TEXT, month NULL, situation, action, outcome (lengths checked in code, ≤ 2000 here), status IN ('draft','ready'), proposal_id NULL, updated_at)`
- `fs_skills(id, name UNIQUE COLLATE NOCASE 1–60, category 1–7, level 1–5, created_at)`; `fs_skill_links(skill_id, other_skill_id NULL, competency_id NULL, strength REAL 0–1)`, CHECK exactly one of the two targets
- `fs_level_events(id, skill_id, from_level NULL, to_level 1–5, evidence ≤ 300, proposal_id NULL, at)`
- `fs_recommendations(id, skill_id, kind IN ('task','course'), title, provider, url NULL https, price, free INTEGER 0/1, status IN ('open','done','dismissed','sent'), task_id NULL REFERENCES tasks, created_at)`
- `fs_study(id, day, minutes 1–600, skill_id NULL, recommendation_id NULL, created_at)`; `fs_study_target(id, minutes_per_week 0–3000, changed_at)`
- `fs_progress(month PRIMARY KEY, competencies_ready, competencies_new, level_changes_json, study_minutes, resume_label NULL, made_at)`
- Never-delete triggers on every table. Header comment explains each table and that only owner-approved text is stored.

- [ ] **Step 1: Failing tests:** good rows in each table; refused: level 6, bad month format, pending proposal with decided_at, skill link with both or neither target, http URL, minutes 0, duplicate skill name differing only in case; deletes refused; `tests/test_db.py` passes.
- [ ] **Step 2–4:** fail, write, pass.
- [ ] **Step 5: Commit** `Migration 016: Flight School`

### Task 4: The store

**Files:** Create `src/aicity/flight_store.py`; Test `tests/test_flight_store.py`

**Interfaces:**
- `class FlightError(ValueError)`, `class FlightNotFound(LookupError)`, `class FlightConflict(Exception)`
- `class FlightStore(conn, *, clock=utc_now)`:
  - `save_draft(self, month: str, text: str) -> None` (creates the month; refused once done)
  - `draft(self, month: str) -> str`
  - `add_proposals(self, month: str, items: list[dict]) -> list[int]` (items already validated by Task 6; month becomes `proposed`)
  - `pending(self, month: str | None = None) -> list[dict]` (`{id, month, kind, payload}`)
  - `decide(self, proposal_id: int, action: str, payload: dict | None = None) -> None` (`accept` | `edit` | `reject`; applies; then checks whether the month is done)
  - `month_status(self, month: str) -> dict` (`{status, pending, decided, todo_task_id}`)
  - `skills(self) -> list[dict]`, `examples(self) -> list[dict]`, `coverage(self) -> tuple[int, int]` (ready competencies, 34)
  - `set_study_target(self, minutes: int) -> None`, `log_study(self, day: str, minutes: int, skill: str | None = None) -> None`
  - `send_recommendation(self, rec_id: int, tasks: TaskStore) -> int` (creates a `personal` to-do titled with the recommendation; status `sent`)
- Applying: `bullet` → `fs_bullets`; `example` → `fs_examples` (ready); `new_skill` → skill + links (+ level event from None); `level_change` → level + event; `recommendation` → open row; `resume_change` → recorded only (the accepted proposal row keeps its payload); Task 9 applies accepted resume changes, including ones accepted before the resume was imported.
- Month done (Decisions): progress row and to-do completed through `TaskStore.complete`; the resume version bump is added in Task 9.

- [ ] **Step 1: Failing tests:** draft save and read; draft refused once done; each kind applies on accept; edit applies the edited payload and re-validates; reject applies nothing; Review Focus 2 (`test_deciding_twice_is_refused`); Review Focus 3 (`test_level_change_for_unknown_skill`, and `test_new_skill_then_level_change_in_one_batch`); month done after the last decision, saves progress with the right counts and completes the to-do; coverage counts only ready examples, once per competency; study target history and logging with no target; send recommendation creates one to-do; skill name match is case-insensitive.
- [ ] **Step 2–4:** fail; implement, each write in one `with_transaction(..., immediate=True)`; pass.
- [ ] **Step 5: Commit** `Flight School: the store`

### Task 5: The monthly to-do

**Files:** Create `src/aicity/flight_reminder.py`; Modify `src/aicity/reminder_loop.py` (Personal only, when `[career]` exists); Test `tests/test_flight_reminder.py`

**Interfaces:** `def check_flight_todo(conn, now_local: datetime, settings: CareerSettings, reminder_time: time, tasks: TaskStore) -> int` (0 or 1 made).

- [ ] **Step 1: Failing tests:** before the day or time → nothing; on the day after the time → one task with the Decisions' title, category, notes and reminder, linked to last month; Review Focus 4 (`test_closed_on_the_first_still_gets_it_once`, `test_done_month_never_gets_one`); the reminder loop calls it only for Personal and only with `[career]`; a failure is logged and never stops reminders.
- [ ] **Step 2–4:** fail, implement, pass; full suite.
- [ ] **Step 5: Commit** `Flight School: monthly to-do`; open PR 1.

---

## PR 2: the monthly run in Claude Code

### Task 6: Proposals schema

**Files:** Create `src/aicity/flight_proposals.py`; Test `tests/test_flight_proposals.py`

**Interfaces:** `def validate_proposals(data: object) -> list[dict]` (raises `FlightError` naming the item index and field; the whole file is refused on any error); `def validate_payload(kind: str, payload: object) -> dict`.

- [ ] **Step 1: Failing tests:** each kind's good payload passes; Review Focus 1 (parametrised: action over the limit, level 7, unknown competency, http URL, unknown kind, extra field, missing field, non-list top level); error message names the item number and field, never echoes the text.
- [ ] **Step 2–4:** fail, implement with the limits from Task 2, pass.
- [ ] **Step 5: Commit** `Flight School: proposals schema`

### Task 7: `scripts/flight.py`

**Files:** Create `scripts/flight.py`; Test `tests/test_flight_cli.py`

**Commands** (exit 0 on success, 2 with a one-line message on bad input):
- `save-draft YYYY-MM` (text from stdin; appends with a blank line unless `--replace`)
- `draft YYYY-MM` (prints the draft)
- `propose FILE` (validates with Task 6, saves; prints how many per kind)
- `pending [YYYY-MM]` (prints numbered proposals, one per line, kind first)
- `decide ID accept|reject` and `decide ID edit FILE`
- `status [YYYY-MM]` (month status, coverage `N / 34`)

- [ ] **Step 1: Failing tests** (run `main(argv)` against a temporary data dir): each command's happy path; `propose` with a bad file saves nothing and exits 2; the Personal database missing → exit 2 "Open the app once first."; never touches the Sample database.
- [ ] **Step 2–4:** fail, implement with `argparse`, pass.
- [ ] **Step 5: Commit** `Flight School: helper command`

### Task 8: The `/flight-log` skill

**Files:** Create `.claude/skills/flight-log/SKILL.md`; Modify `docs/RUNBOOK.md` (the monthly run)

**Content (instructions only, no personal data):** when to use (the monthly to-do or the owner asks); steps: ask for the month, collect the dump in the chat (and any photos; never save photos), `save-draft`, read the draft, propose bullets, examples, skills, level changes, recommendations and resume changes following the rules, web-search course topics only, write a proposals file in the session's scratch folder, `propose`, then walk the owner through `pending` and `decide` one by one, then `status`. Rules section copied from the design (only what's stated; general level for the main job, never names, documents, identifiers or meeting details; "I" statements; limits; free-first with prices; propose, never apply).

- [ ] **Step 1:** write the skill and runbook entry.
- [ ] **Step 2: Dry run** with a made-up dump on a temporary data dir: the skill's steps produce a valid file, `propose` accepts it, and `decide` finishes the month.
- [ ] **Step 3: Commit** `Flight School: /flight-log skill`; open PR 2.

---

## PR 3: resume and local model

### Task 9: Master resume, Word import and export

**Files:** Create migration `017_flight_resume.sql` (`fs_resume_sections`, `fs_resume_items`, `fs_resume_versions`); Create `src/aicity/flight_resume.py`; Modify `scripts/flight.py` (`resume-import PATH`, `resume-confirm`, `resume-export PATH`), `requirements.lock` (`python-docx`, pinned, after the owner's yes); Test `tests/test_flight_resume.py` with generated `.docx` fixtures made in the test (never a real resume)

**Interfaces:** `def preview_import(path: Path) -> list[Section]`; `def confirm_import(conn, sections) -> str` (label `v1 …`); `def apply_resume_change(conn, payload: dict) -> None`; `def bump_version(conn, month: str) -> str`; `def export_docx(conn, path: Path) -> None`. Headings become sections; paragraphs and list items become items.

- [ ] **Step 0:** show the owner `python-docx`'s source, licence, what it adds (no network, no hooks) and the exact pin; wait for yes.
- [ ] **Step 1: Failing tests:** headings to sections; Review Focus 5 (no headings → one "Resume" section; tables and empty paragraphs skipped; nothing saved before confirm); add, replace, remove changes; version label `v2 Nov 2026` after a done month with a resume change; export round-trips section and item text.
- [ ] **Step 2–4:** fail, implement, pass. `confirm_import` then applies any resume changes accepted before the import, oldest first (test: `test_changes_accepted_before_import_are_applied`); deciding a resume change after the import applies it at once; month done now bumps the version.
- [ ] **Step 5: Commit** `Flight School: master resume`

### Task 10: Local-model analysis

**Files:** Create `src/aicity/flight_local.py`; Modify `scripts/flight.py` (`analyse YYYY-MM --local`); Test `tests/test_flight_local.py` (httpx MockTransport; no real model)

**Interfaces:** `def analyse_local(draft: str, model: str, client: httpx.Client) -> list[dict]` (POST `http://127.0.0.1:11434/api/chat`, JSON format requested, the same rules as the skill; the answer goes through `validate_proposals`; a bad answer raises `FlightError("The local model's answer couldn't be used. Nothing was saved.")`).

- [ ] **Step 1: Failing tests:** a good mocked answer becomes validated proposals; an invalid answer saves nothing; Ollama not running → "Start Ollama first."; the request goes only to 127.0.0.1.
- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5:** finish: fresh full suite, ruff, format, gitleaks, blocked words; `graphify update .`; commit `Flight School: local-model analysis`; open PR 3. Downloading a model is a separate step with the owner's yes.
