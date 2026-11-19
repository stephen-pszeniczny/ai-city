# A side-work company without pay timing: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> Public file. Generic names only; the real company name lives in the private settings.

**Goal:** A `[pay_schedules.<id>]` block may be just a name, so a new company appears in the dropdowns and as its own income source, with no pay weeks, windows or "overdue".

**Architecture:** `PaySchedule`'s three timing fields become optional, with a `timed` property. Every place that works out pay weeks (`side_work_view` grouping, `open_weeks`) treats an untimed schedule like no schedule for timing, but keeps its name. The dropdowns and the Income view already list every schedule, so they need no change.

**Tech Stack:** Python 3 + FastAPI, pytest. No frontend change expected.

**Spec:** `docs/superpowers/specs/2026-11-19-side-work-company-without-timing-design.md`

**Branch:** `side-work-untimed-company` off `main`.

## Global Constraints

- The four timing keys are all-or-nothing in a block; a partial set is refused, naming the missing keys.
- A schedule with timing behaves exactly as today (all existing tests stay green unchanged).
- Sample mode unchanged. The real company name goes only in the private settings.

## Review Focus

1. **Untimed company's entries never show "overdue"** and never count in the Vault badge, however old. Test: `test_untimed_company_is_never_overdue` (Task 1).
2. **A block with timing partly filled in** (e.g. `week_starts` only) is refused, not treated as untimed. Test: `test_partial_timing_is_refused` (Task 1).
3. **Recording a payment for an untimed company's entries** works and the entries show as paid under the company's name. Test: `test_untimed_company_entries_can_be_paid` (Task 1).
4. **A statement deposit matching an untimed company's `deposit_match`** is offered as bonus / link / skip, never a week. Test: `test_untimed_company_deposit_has_no_week` (Task 1).
5. **Its income counts as its own source**, not "Other side income". Test: `test_untimed_company_is_its_own_income_source` (Task 1).

---

### Task 1: Untimed pay schedules

**Files:**
- Modify: `src/aicity/settings.py` (`PaySchedule`, `_pay_schedules`, docstring)
- Modify: `src/aicity/side_work.py` (grouping: untimed → company group, status `no_schedule`, name kept)
- Modify: `src/aicity/statement_import.py` (`open_weeks` skips untimed)
- Modify: `settings.example.toml` (commented name-only example), `docs/RUNBOOK.md` (one line in "Adding a side-work platform")
- Test: `tests/test_settings.py`, `tests/test_vault_routes.py`, `tests/test_statement_routes.py`

**Interfaces:**
- Produces: `PaySchedule(id, name, week_starts: int | None, release_after: tuple[int, int] | None, arrive_after: tuple[int, int] | None, deposit_match: str | None = None)` with `timed -> bool` (all three set).
- `pay_period` / `arrival_window` are only ever called with a timed schedule.

- [ ] **Step 1: Write the failing tests**
  - Settings: `test_name_only_schedule_is_untimed` (block `{"name": "Platform B"}` → `timed is False`, timing fields `None`); `test_name_only_schedule_keeps_deposit_match`; `test_partial_timing_is_refused` (name + `week_starts` only → error naming `period`, `released_days_after_period_end`, `arrives_days_after_release`). Existing `test_missing_pay_schedule_key_is_refused` keeps passing (its block still has the other timing keys).
  - Routes (settings = example + timed `platform_a` + untimed `[pay_schedules.platform_b] name = "Platform B"`):
    - `test_untimed_company_is_in_the_dropdown`: GET side-work → `schedules` lists both ids.
    - `test_untimed_company_is_never_overdue`: an entry for `platform_b` 60 days before "today" → its group status `no_schedule`, `period` and `window` null, `company_name == "Platform B"`; GET `/api/vault/badge` → not "N overdue".
    - `test_untimed_company_entries_can_be_paid`: record a payment for its entries → group status `paid`.
    - `test_untimed_company_is_its_own_income_source`: a received payment → `/api/vault/income` month `by_source` has key `platform_b` named "Platform B" (not `extra`).
  - Statement route (`tests/test_statement_routes.py`, an extra settings block with `deposit_match = "ACME TASKS"`): `test_untimed_company_deposit_has_no_week` → the row is under `platform`, proposal kind is not `week`, and `weeks` has none for `platform_b`; confirming it as `bonus` stores it.
- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_settings.py tests/test_vault_routes.py tests/test_statement_routes.py -q`. Expected: FAIL (untimed block refused today).
- [ ] **Step 3: Implement.** In `_pay_schedules`: required `{"name"}`; timing keys `{"period", "week_starts", "released_days_after_period_end", "arrives_days_after_release"}` all or none. In `side_work_view`'s bucket key and the group's `period/window`: use the week path only when `schedule is not None and schedule.timed`; `company_name` still uses `schedule.name`. In `open_weeks`: skip entries whose schedule is missing or untimed.
- [ ] **Step 4: Run** `.venv/bin/pytest -q` and `cd frontend && npm test && npm run typecheck && npm run build`. Expected: all PASS.
- [ ] **Step 5: Commit** `git commit -m "Side work: a company can be just a name (no pay timing)"`

### Task 2: Finish

- [ ] `graphify update .`; fresh full check (SPEC section 2: clear caches; pytest, hook tests, ruff check + format, frontend test/typecheck/build, gitleaks full history, blocked words over tracked files); commit if anything changed.
- [ ] After merge and Steve's go-ahead: add `[pay_schedules.<id>]` with only `name = "<the company>"` to `~/AI-City-Data/settings/settings.toml` (append the block; don't read the rest of the file). Steve says the display name; the id is a short lowercase code.
