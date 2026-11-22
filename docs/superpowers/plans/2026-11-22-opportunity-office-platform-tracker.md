# Opportunity Office platform tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Opportunity Office as a platform tracker (roster, check rounds in the Sunday check-in, opportunity log, profile snapshots) and remove the parts of PR #25 it doesn't use.

**Architecture:** Two PRs. **PR A (backend, Tasks 1–6):** `[jobs]` settings reshaped to platforms + pay floor + check intervals; migration 015 drops the leads/scores/scan tables and replaces `job_platform_events` with status, check, profile and project tables; `jobs_store.py` rewritten; `/api/jobs` routes rewritten; Sample data; the Vault's side-work view offers active platforms. **PR B (screens, Tasks 7–10):** Platforms and Log desk apps, the check round section in the Sunday check-in, the belt badge and built flag, the side-work company list.

**Tech Stack:** Python 3.13, FastAPI, SQLite, pytest; React + TypeScript, TanStack Query, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-22-opportunity-office-platform-tracker-design.md` (public, example values) and SPEC.md section 8, Opportunity Office (private).

## Global Constraints

- Public repo: example values only ("Platform A", made-up names in Sample). Real platforms, pay, domains and projects live in the private settings and the Personal database.
- No credentials stored, nothing fetched, no network calls anywhere in this building.
- No project description field; titles are written by the owner (spec section 12).
- Pay floor $30 USD/hr, $40+ preferred; CAD beside USD at the Bank of Canada rate (`fx.latest_rate`).
- Check intervals: active 3 days; applied, assessment, onboarding 7; paused 30; not applied and rejected never.
- Touch ID lock on every `/api/jobs` route except `unlock` and `badge`; the badge is a count only, never a platform name. Sample mode needs no key.
- Rows are never hard-deleted (never-delete triggers). Every GET only reads.
- Nothing unused stays committed: delete `jobs_text.py`, `jobs_score.py` and their tests, and every unused name in what remains.
- Owner's choices (2026-11-22): a finished project is **Ended**; the leads, scores and scan-run tables are removed (0 rows in Personal).
- Run `ruff format src tests` and `ruff check` before every commit; chain `ruff check && git commit`. Frontend: `npm test`, `npx tsc -b`, `npm run build`.

## Decisions made here

- **Due rule:** interval from the platform's current status. Base = the later of its last check and its last status change (local date); no events at all → due today. `next_check_on = base + interval`; due when `today >= next_check_on`. A status with no interval → never due, `next_check_on = None`.
- **Project status moves:** forward along `found → applied → assessment → accepted → active → ended` (skipping allowed, e.g. found → accepted), or to `rejected` from found, applied, assessment or accepted. `rejected` and `ended` are final. Anything else → `JobsConflict` (409).
- **Pay:** one hourly rate per project (`pay_cents`, `currency` USD or CAD, both or neither). USD per hour = CAD ÷ rate (rate = CAD per USD). Flag `below_floor` only when the USD figure is known and below the floor; no rate → CAD shown, no USD, no flag.
- **Refresh nudge:** a platform whose status is applied or later (not not_applied, not rejected) and whose `profile_updated_on` is missing, 90+ days old, or whose `resume_label` differs from `master_resume_label` (when set).
- **Vault hand-off:** the side-work view gains `active_platforms: list[str]`: names of platforms with an active project, minus any whose id matches a pay schedule id (those are already in the list). The form lists them after the schedules; choosing one stores the name as the company text, like "Other".
- **Old settings:** `parse_jobs` refuses the old keys (`profiles`, `sources`, `scan_day`, `scan_time`, `top_n`, `follow_up_days`, `roll_off_days`) with one message: "jobs: profiles, sources and scan settings are no longer used (2026-11-22 redesign); remove them." The owner's private file is reshaped (with his OK, backup first) before `app.py update`.

## Review Focus

1. **A platform with no history** (just added to settings) shows its start status and is due today if that status has an interval; one removed from settings but with rows in the database is simply not shown. Test in Task 3.
2. **The badge** answers a count only, works while locked, and gives null (not a 500) when `[jobs]` is missing or the settings file is broken. Test in Task 4.
3. **CAD pay with no exchange rate known** shows CAD, no USD and no floor flag, never a wrong flag. Test in Task 3.
4. **The owner's old `[jobs]` shape** gives the clear "no longer used" message, never a crash or a silent accept. Test in Task 1.
5. **Changing status resets the check clock** (active → paused moves the next check to 30 days from the change; a check stamped today moves it on by the interval). Test in Task 3.

---

## PR A: backend

### Task 1: `[jobs]` settings reshaped

**Files:** Modify `src/aicity/jobs_settings.py`, `settings.example.toml` (replace the commented `[jobs]` example with the design doc's), `tests/test_jobs_settings.py` (rewrite); Delete `docs/superpowers/specs/2026-11-20-opportunity-office-design.md` (replaced by the 2026-11-22 design; git history keeps it)

**Interfaces:**
- `STATUSES = ("not_applied", "applied", "assessment", "onboarding", "active", "paused", "rejected")`
- `DEFAULT_CHECK_DAYS = {"active": 3, "applied": 7, "assessment": 7, "onboarding": 7, "paused": 30}`
- `@dataclass(frozen=True) class JobPlatform: id: str; name: str; url: str; start_status: str`
- `@dataclass(frozen=True) class JobsSettings: pay_floor_usd: Decimal; pay_preferred_usd: Decimal; master_resume_label: str | None; check_days: dict[str, int]; platforms: tuple[JobPlatform, ...]`
- `def parse_jobs(t: dict) -> JobsSettings`. Rules: floor ≤ preferred (money text, defaults "30"/"40"); `check_days` keys only from the five statuses with intervals, values 1–90, missing keys take the default; label 1–40 chars; platforms 1–30, ids `[a-z][a-z0-9_]{0,30}` unique, name 1–60, url `https://`, start_status in `STATUSES`.
- Remove `JobProfile`, `JobSource`, `SOURCE_KINDS`, `JOB_TYPES`, the old `STAGES`.

- [ ] **Step 1: Failing tests:** `test_jobs_parses_with_defaults` (floor `Decimal("30")`, `check_days == DEFAULT_CHECK_DAYS`, start_status `not_applied`); `test_check_days_override_one` (`active = 2` keeps the other four defaults); parametrised `test_jobs_refuses` (floor above preferred, duplicate id, `http://` url, unknown status, `check_days.rejected = 5`, `check_days.active = 0`, no platforms, unknown key); `test_old_shape_gets_a_clear_message` (a dict with `profiles` and `sources` → message contains "no longer used").
- [ ] **Step 2:** run `.venv/bin/pytest tests/test_jobs_settings.py -q` → fail.
- [ ] **Step 3:** implement; old-key check before `_only_keys`.
- [ ] **Step 4:** run → pass. Other suites will fail until Tasks 2–5; that's expected inside this PR, so don't run the full suite yet.
- [ ] **Step 5: Commit** `Settings: Opportunity Office becomes a platform tracker`

### Task 2: Migration 015

**Files:** Create `src/aicity/migrations/015_platform_tracker.sql`; Rewrite `tests/test_jobs_schema.py`

**Interfaces (STRICT; stamps UTC with the 013-style CHECK; platform ids `GLOB '[a-z]*'`, 1–31 chars):**
- `DROP TABLE job_lead_scores; DROP TABLE job_leads; DROP TABLE job_scan_runs;`
- `platform_status_events(id, platform_id, status IN STATUSES, changed_at)`, filled from `job_platform_events` with `not_joined → not_applied`, `quiet → paused`, others unchanged (keeps Sample's history); then `DROP TABLE job_platform_events`.
- `platform_checks(id, platform_id, outcome IN ('nothing','found'), checked_at)`.
- `platform_profiles(platform_id PRIMARY KEY, pay_low_cents INTEGER NULL ≥ 0, pay_high_cents INTEGER NULL ≥ pay_low, pay_currency TEXT NULL IN ('USD','CAD'), resume_label TEXT NULL 1–40, domains_json TEXT NOT NULL DEFAULT '[]', assessments_json TEXT NOT NULL DEFAULT '[]' (json_valid both), profile_updated_on TEXT NULL date, updated_at)`; CHECK currency present iff a pay figure is.
- `job_projects(id, platform_id, title 1–80 trimmed, pay_cents INTEGER NULL ≥ 0, currency NULL IN ('USD','CAD'), CHECK ((pay_cents IS NULL) = (currency IS NULL)), hours_per_week INTEGER NULL 1–80, status IN ('found','applied','assessment','accepted','rejected','active','ended'), found_on date, status_at)`.
- Never-delete triggers on all four new tables. Header comment in the 014 style: what each table is, the redesign, that the dropped tables were empty in Personal.

- [ ] **Step 1: Failing tests:** good rows in each table; refused: bad status, `pay_cents` without currency, title over 80, `hours_per_week = 0`, invalid JSON; deletes refused; `test_old_platform_stages_are_carried_over` (open with `load_migrations()[:14]`, insert `not_joined` and `quiet` events, migrate → `not_applied`, `paused`); `test_old_tables_are_gone`.
- [ ] **Step 2–4:** run (fail); write the migration; run (pass) with `tests/test_db.py`.
- [ ] **Step 5: Commit** `Migration 015: platform tracker tables; old leads tables removed`

### Task 3: The store

**Files:** Rewrite `src/aicity/jobs_store.py`, `tests/test_jobs_store.py`; Delete `src/aicity/jobs_text.py`, `src/aicity/jobs_score.py`, `tests/test_jobs_text.py`, `tests/test_jobs_score.py`

**Interfaces:**
- Keep `JobsError(ValueError)`, `JobsNotFound(LookupError)`, `JobsConflict(Exception)`.
- `PROJECT_STATUSES = ("found", "applied", "assessment", "accepted", "rejected", "active", "ended")`
- `@dataclass(frozen=True) class PlatformCard: id, name, url, status, status_at: str | None, last_checked_at: str | None, next_check_on: str | None, due: bool, pay_low_cents, pay_high_cents, pay_currency, resume_label, domains: list[str], assessments: list[str], profile_updated_on: str | None, refresh_due: bool`
- `@dataclass(frozen=True) class ProjectView: id, platform_id, platform_name, title, pay_cents, currency, pay_usd_cents: int | None, pay_cad_cents: int | None, hours_per_week, status, found_on, status_at, flags: list[str]`
- `class JobsStore(conn, settings: JobsSettings, *, clock=utc_now, usd_rate: Decimal | None = None)`:
  - `platforms(self) -> list[PlatformCard]` (settings order; reads only)
  - `due(self) -> list[PlatformCard]`; `due_count(self) -> int`
  - `set_status(self, platform_id: str, status: str) -> PlatformCard`
  - `record_check(self, platform_id: str, outcome: str) -> PlatformCard`
  - `set_profile(self, platform_id: str, **fields) -> PlatformCard` (fields: `pay_low_cents, pay_high_cents, pay_currency, resume_label, domains, assessments, profile_updated_on`; only given fields change; domains and assessments are lists of 1–40-char strings, at most 20)
  - `projects(self) -> list[ProjectView]` (open ones first in status order, then rejected and ended, newest first within)
  - `add_project(self, *, platform_id: str, title: str, pay_cents: int | None, currency: str | None, hours_per_week: int | None) -> ProjectView` (status `found`, `found_on` today)
  - `edit_project(self, project_id: int, **fields) -> ProjectView` (title, pay_cents, currency, hours_per_week)
  - `set_project_status(self, project_id: int, status: str) -> ProjectView`
  - `active_platform_names(self) -> list[str]`
- Dates use the Mac's local date (`clock().astimezone().date()`), as the old `_today`.

- [ ] **Step 1: Failing tests:** start status from settings with no rows; Review Focus 1 (`test_new_platform_is_due_today_if_it_has_an_interval`, `test_not_applied_is_never_due`, `test_platform_removed_from_settings_is_not_shown`); Review Focus 5 (`test_status_change_resets_the_check_clock`, `test_a_check_moves_the_next_check_on`); `record_check` appends one row and `found` is accepted; refresh rules (90 days, label differs from master, never for not_applied); `set_profile` partial update keeps other fields; project moves (legal, skip-ahead, rejected from accepted, ended final → 409, active → found → 409); Review Focus 3 (`test_cad_pay_without_a_rate_has_no_usd_and_no_flag`); `below_floor` for USD 25; CAD 45 at rate 1.40 → USD 3214 cents, no flag; `active_platform_names`; unknown platform → `JobsNotFound`; bad title → `JobsError`; `platforms()` and `projects()` write nothing (`conn.total_changes` unchanged).
- [ ] **Step 2:** run → fail. **Step 3:** implement; each write in one `with_transaction(..., immediate=True)`, as `grocery.py`. **Step 4:** run → pass.
- [ ] **Step 5: Commit** `Opportunity Office: platform tracker store; posting reader and scoring removed`

### Task 4: Routes

**Files:** Rewrite `src/aicity/jobs_routes.py`, `tests/test_jobs_routes.py`; update `tests/test_get_routes_read_only.py`

**Interfaces** (header `X-Jobs-Key`; 403 "Opportunity Office is locked."; 400 "Opportunity Office isn't set up yet."; 404/409/422 from store errors; bodies `extra="forbid", strict=True`):
- `POST /api/jobs/unlock` → `{"key"}` (null in Sample). Unlocked.
- `GET /api/jobs/badge` → `{"text"}`: `"1 platform to check"`, `"3 platforms to check"` or null. Unlocked. Any settings problem → null.
- `GET /api/jobs/platforms` → `{"platforms": [card], "due": [card], "refresh": [card]}`
- `PUT /api/jobs/platforms/{id}/status` `{status}`; `POST /api/jobs/platforms/{id}/check` `{outcome}`; `PUT /api/jobs/platforms/{id}/profile` `{any profile field}` → card
- `GET /api/jobs/projects` → `{"projects": [view], "rate": {"value","date"} | null, "floor_usd": "30", "preferred_usd": "40"}`
- `POST /api/jobs/projects` (201), `PUT /api/jobs/projects/{id}`, `POST /api/jobs/projects/{id}/status` → view

- [ ] **Step 1: Failing tests:** `test_every_locked_route_needs_the_key` (parametrised, no key and stale key); Review Focus 2 (`test_badge_is_a_count_only` with a platform named "Zeta Labs" absent from the text; `test_badge_null_without_jobs`; `test_badge_null_with_a_broken_settings_file`); Sample needs no key; check → card due false; add project → 201 then listed; illegal move → 409; GETs added to the read-only list.
- [ ] **Step 2–4:** run (fail), implement in the existing style (`_require_key`, `_open`, `_settings` with Sample's `SAMPLE_JOBS`), run (pass).
- [ ] **Step 5: Commit** `Opportunity Office: platform tracker routes`

### Task 5: Sample mode

**Files:** Modify `src/aicity/sample_data.py`; Test `tests/test_sample_data.py`

**Interfaces:** `SAMPLE_JOBS: JobsSettings` (four made-up platforms: Nimbus Experts active, Orbit Raters assessment, Quasar Tasks applied, Comet Labs not applied; `master_resume_label="v2 Sample"`). `def seed_jobs(conn, now) -> bool` under a new meta key `sample_jobs_seeded_v2`: checks making one active platform due and one not; profiles (one 100 days old → refresh); projects: one each found, applied, active, ended, rejected, one CAD-paid; nothing named after a real company.

- [ ] **Step 1: Failing test:** `test_sample_jobs_seed` (statuses, exactly one due, one refresh, project count per status; seeding twice adds nothing; `test_seed_jobs_refuses_the_personal_database` kept).
- [ ] **Step 2–4:** run (fail), implement, run (pass). Now run the full suite: `.venv/bin/pytest -q` → all pass.
- [ ] **Step 5: Commit** `Sample mode: made-up platforms and projects`

### Task 6: Side-work view offers active platforms; finish PR A

**Files:** Modify `src/aicity/vault_routes.py` (side-work view), `tests/test_side_work_routes.py` (or the existing side-work view test file)

**Interfaces:** side-work view JSON gains `"active_platforms": list[str]` (Decisions: Vault hand-off). Missing `[jobs]` → `[]`.

- [ ] **Step 1: Failing tests:** an active project on platform "Platform B" → `["Platform B"]`; a platform whose id equals a pay schedule id is left out; no `[jobs]` → `[]`.
- [ ] **Step 2–4:** run (fail), implement, run (pass).
- [ ] **Step 5:** `graphify update .`; clear caches; full suite, ruff, format check, type check, gitleaks, blocked words; live Sample check on port 8799 calling each route once.
- [ ] **Step 6: Commit** `The Vault: side work offers platforms with an active project`; open PR A. **Before merging:** reshape the owner's private `[jobs]` (show him the new section, back up first), then `scripts/app.py update`.

---

## PR B: screens

### Task 7: API client and the lock

**Files:** Modify `frontend/src/api.ts`, `frontend/src/vault/VaultLockScreen.tsx` (a `place` and `unlock` prop, Vault's defaults unchanged); Create `frontend/src/jobs/JobsGate.tsx`, `frontend/src/jobs/jobs.ts`; Test `frontend/tests/jobs.test.ts`

**Interfaces:** types `PlatformCard`, `ProjectView` mirroring Task 3; functions `unlockJobs`, `getJobsBadge`, `getPlatforms`, `setPlatformStatus`, `checkPlatform`, `setPlatformProfile`, `getProjects`, `addProject`, `editProject`, `setProjectStatus`; a `jobsKey` like `vaultKey` (sent as `X-Jobs-Key`, cleared on 403, `onJobsLocked`). `jobs.ts`: `nextProjectStatuses(status: string): string[]` (Decisions: project moves), `checkLabel(card: PlatformCard, today: string): string` ("Due today", "Due in 2 days", "—"), `payText(view: ProjectView): string` ("$45 USD/hr · $63 CAD").

- [ ] **Step 1:** failing `node --test` tests for the three helpers. **Step 2–4:** fail, implement, pass; `npx tsc -b`.
- [ ] **Step 5: Commit** `Opportunity Office screens: API client and lock`

### Task 8: Platforms and Log apps

**Files:** Create `frontend/src/jobs/PlatformsPanel.tsx`, `frontend/src/jobs/LogPanel.tsx`, `frontend/src/jobs/ProjectForm.tsx`, `frontend/src/jobs/jobs.css`; Modify `frontend/src/desktop/apps.ts` (jobs: Platforms first, then Log), `frontend/src/desktop/Desktop.tsx` (icons 🛰 and ✎, panels)

- Platforms: one card per platform, grouped by status as chips; check date line from `checkLabel`; **Open** link (`target="_blank" rel="noreferrer"`); status picker; a small profile editor (pay range, resume label, domains and assessments as chips). No paragraphs (spec section 7).
- Log: projects grouped open / finished; **+ Log a project** opens `ProjectForm` (platform, title max 80, pay, currency, hours); status buttons from `nextProjectStatuses`; `payText` and a "below floor" chip.
- [ ] **Step 1:** add an `apps.ts` test (`appsFor("jobs")` → Platforms, Log). **Step 2–4:** fail, implement, pass; `npx tsc -b`; `npm run build`.
- [ ] **Step 5: Commit** `Opportunity Office: Platforms and Log apps`

### Task 9: Check round in the Sunday check-in

**Files:** Create `frontend/src/jobs/CheckRound.tsx`; Modify `frontend/src/plan/CheckinPanel.tsx` (a section after the to-dos)

- Inside `JobsGate`: lists `due` platforms with **Open**, **Nothing new**, **Found something** (opens `ProjectForm` with the platform chosen and records the check as `found` when saved). No platforms due → one short line "No platforms to check". `[jobs]` missing (400) → the section is hidden.
- [ ] **Step 1–4:** implement; `npx tsc -b`; `npm run build`; live Sample check in the browser (open the check-in, tap Nothing new, the platform leaves the list).
- [ ] **Step 5: Commit** `Sunday check-in: Opportunity Office check round`

### Task 10: Belt, side-work list, finish

**Files:** Modify `frontend/src/belt/built.ts` (add `"jobs"`), `frontend/src/belt/Labels.tsx` (jobs badge from `getJobsBadge`), `frontend/src/vault/SideWorkPanel.tsx` (company options add `active_platforms` after the schedules, stored as text)

- [ ] **Step 1:** update the built-set test if one exists; implement; `npm test`, `npx tsc -b`, `npm run build`.
- [ ] **Step 2:** live Sample run: belt shows the Opportunity Office landmark and "1 platform to check"; the Vault side-work form lists the active sample platform.
- [ ] **Step 3:** full fresh checks (both suites, lint, types, build, gitleaks, blocked words); `graphify update .`; runbook line under Common fixes ("Opportunity Office isn't set up yet": add `[jobs]`).
- [ ] **Step 4: Commit** `Opportunity Office built on the belt`; open PR B.
