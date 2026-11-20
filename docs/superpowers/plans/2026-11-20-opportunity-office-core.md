# Opportunity Office core (PR 1 of 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Opportunity Office backend without the scan: settings (profiles, sources, platforms), the data tables, text and pay extraction, rules scoring, the leads and platform store, Touch-ID-locked routes, and Sample data.

**Architecture:** A new optional `[jobs]` settings section parsed in its own module. Migration 014 adds four STRICT tables. Pure functions extract pay and facts from posting text (`jobs_text.py`) and score a posting against a profile (`jobs_score.py`). `jobs_store.py` saves pasted leads, changes statuses and platform stages, and reads the inbox. `jobs_routes.py` serves `/api/jobs`, locked with a second instance of the Vault's lock. PRs 2–4 add the scan, the screens with check-in and belt, and follow-ups with roll-off.

**Tech Stack:** Python 3.13, FastAPI, SQLite, pytest.

**Spec:** `docs/superpowers/specs/2026-11-20-opportunity-office-design.md` (PR 1 of 4). Later PRs: 2 scan + `jobs` notification; 3 Leads and Platforms apps, check-in section, belt built + badge; 4 follow-up to-dos, 90-day roll-off, runbook.

## Global Constraints

- Public repo: example values only. Real platforms, stages, skills and keywords live in the private settings and the Personal database.
- `[jobs]` is optional; settings without it keep loading. Strict parsing: unknown keys refused, values never echoed in errors.
- Pay floor $30 USD/hr, $40+ preferred (example file uses these); ranges ranked by the low end; a range with low < floor ≤ high is kept and flagged.
- Keep only remote, open-to-Canada (or unknown, flagged), not full-time roles; exclude words drop a posting.
- Job applications are sensitive (spec section 4): every `/api/jobs` route except `unlock` and `badge` needs the jobs key in Personal mode; the badge gives counts only. Sample mode needs no key.
- Pasted links are stored, never fetched. Opportunity Office never reads the resume.
- Every GET only reads. Rows are never hard-deleted (never-delete triggers, as in earlier migrations).
- No new dependencies. Run `ruff format src tests` before every commit; check `git log` after each commit.
- Not in this PR: the scan and its sources, notifications, screens, follow-up to-dos, roll-off, AI.

## Decisions made here (the design leaves these to the plan)

- **Score weights:** skills 50, pay 25, title 15, hours 10 (total 100). Verdict: ≥ 70 strong, ≥ 45 maybe, else skip.
- **Skills score:** share of the background's skills found in the posting (title + text, case-insensitive whole words/phrases), capped at 1.0 when 5 or more match.
- **Pay score:** low end ≥ preferred → 25; ≥ floor → 15; straddling → 8; pay not listed → 0. CAD hourly converts to USD as `cad / rate` (rate = CAD per USD from `fx.latest_rate`); no rate → treated as pay not listed.
- **Hours score:** stated hours overlapping the profile range, or none stated → 10; stated hours entirely outside → 0.
- **Title score:** any `title_words` phrase in the title → 15.
- **Gaps:** profile `gap_words` found in the posting but not in `skills`, at most 5, in settings order.
- **Same role (repost / repaste):** same normalised company and normalised title within 30 days of the first one's `first_seen`. Normalise: lowercase, drop punctuation and the words `remote`, `contract`, `part time`, `freelance`, `canada`, collapse spaces.
- **Inbox lists** (by `list_leads`):
  - *New:* status `new` and (origin `pasted`, or the newest scan batch with `batch_rank <= top_n`), by score then low pay.
  - *Earlier:* status `new` from an older batch.
  - *More results:* newest batch, `batch_rank > top_n`.
  - *Saved*, *Applied* (applied + interview + offer), *Closed* (rejected, skipped, closed postings), in that order.
- **Status changes:** new/saved/skipped → new, saved, skipped or applied; applied → interview, offer, rejected; interview → offer, rejected. Anything else → `JobsConflict` (409). Applying needs a resume label (1–40 chars).
- **Platform stages:** `not_joined`, `applied`, `assessment`, `active`, `quiet`. State = latest event row, else the settings `start_stage` (default `not_joined`). Nudges: platforms with a next step and not snoozed, oldest change first, at most 2. "Not now" snoozes for 28 days.

## Review Focus

1. **Odd pay text** ("$40k", "up to $50/hr", "$30–45 CAD per hour", "£25/hr", "$120,000/year", no pay at all) gives the right unit, currency and flag, never a wrong hourly figure. Test in Task 3.
2. **A locked request** in Personal mode with no key or an old key gets 403 on every jobs route except unlock and badge, and the badge text names no company or title. Test in Task 7.
3. **Pasting the same role twice** (same link, or same company and title) joins the first lead, filling only empty fields, and never makes a second row. Test in Task 5.
4. **Settings that don't add up** (a source naming an unknown profile, an unknown start stage, floor above preferred, duplicate ids) are refused with a clear message. Test in Task 1.
5. **Skip the rest** skips only the New list. Saved, Applied and Earlier leads stay as they were, and pressing it on an empty list does nothing. Test in Task 5.

---

### Task 1: `[jobs]` settings

**Files:** Create `src/aicity/jobs_settings.py`; Modify `src/aicity/settings.py` (allow and parse `jobs`), `settings.example.toml`; Test `tests/test_jobs_settings.py`

**Interfaces:**
- `@dataclass(frozen=True) class JobProfile: id: str; name: str; active: bool; pay_floor_usd: Decimal; pay_preferred_usd: Decimal; hours: tuple[int, int]; job_types: tuple[str, ...]; title_words: tuple[str, ...]; exclude_words: tuple[str, ...]; location_ok: tuple[str, ...]; skills: tuple[str, ...]; gap_words: tuple[str, ...]`
- `@dataclass(frozen=True) class JobSource: id: str; name: str; kind: str; board: str; profiles: tuple[str, ...]; enabled: bool`
- `@dataclass(frozen=True) class JobPlatform: id: str; name: str; url: str; start_stage: str`
- `@dataclass(frozen=True) class JobsSettings: scan_day: int; scan_time: time; top_n: int; follow_up_days: int; roll_off_days: int; profiles: tuple[JobProfile, ...]; sources: tuple[JobSource, ...]; platforms: tuple[JobPlatform, ...]`
- `def parse_jobs(t: dict) -> JobsSettings` (raises `SettingsError`); `Settings.jobs: JobsSettings | None = None`.
- `STAGES = ("not_joined", "applied", "assessment", "active", "quiet")`, `SOURCE_KINDS = ("greenhouse", "ashby", "lever")`, `JOB_TYPES = ("contract", "part_time", "temporary", "freelance")`.
- Rules: ids `[a-z][a-z0-9_]{0,30}` unique within their list; defaults `scan_day="sun"`, `scan_time="19:00"`, `top_n=10` (1–25), `follow_up_days=10` (1–60), `roll_off_days=90` (30–365); at least one profile; floor and preferred are money text, floor ≤ preferred; `hours` two ints 1–60, low ≤ high; word lists 0–50 items, each 1–60 chars, stored lowercase; `skills` 1–50 items; `board` `[A-Za-z0-9_-]{1,60}`; source `profiles` non-empty and each a known profile id; `url` starts `https://`.

- [ ] **Step 1: Failing tests:** `test_jobs_is_optional`; `test_jobs_parses_with_defaults` (scan Sunday 19:00, top_n 10, floor `Decimal("30")`, words lowercased); `test_jobs_refuses` (parametrised, message fragment checked, value never echoed): bad id, duplicate profile id, duplicate platform id, source with unknown profile, unknown source kind, unknown start stage, floor above preferred, `hours = [15, 10]`, `top_n = 0`, empty skills, unknown key in a profile, `url = "http://..."`, no profiles.
- [ ] **Step 2:** run `.venv/bin/pytest tests/test_jobs_settings.py -q` → fail.
- [ ] **Step 3:** implement `parse_jobs` reusing `_only_keys`, `_text`, `_decimal`, `_clock_time`, `_days` from `settings.py` (import them; don't copy). Add `"jobs"` to the allowed top-level keys and `jobs=parse_jobs(data["jobs"]) if "jobs" in data else None`.
- [ ] **Step 4:** commented example block in `settings.example.toml`: profile `ai_training` (floor "30", preferred "40", hours [10, 15], made-up words and skills), source `company_a` (greenhouse, board `companya`), platforms `platform_a` (start_stage active) and `platform_b`.
- [ ] **Step 5:** run → pass; full suite `.venv/bin/pytest -q`.
- [ ] **Step 6: Commit** `Settings: Opportunity Office profiles, sources and platforms`

---

### Task 2: Migration 014

**Files:** Create `src/aicity/migrations/014_jobs.sql`; Test `tests/test_jobs_schema.py`

**Interfaces (all STRICT, stamps UTC `YYYY-MM-DDTHH:MM:SSZ` with the 013-style CHECK, ids `GLOB '[a-z]*'` 1–31 chars):**
- `job_scan_runs(id, started_at, finished_at NULL, outcome_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(outcome_json)))`.
- `job_leads(id, origin TEXT NOT NULL ('pasted' or a source id), external_id TEXT NULL, url TEXT NULL CHECK https:// prefix and ≤ 500, title 1–200 trimmed, company 1–120 trimmed, location TEXT NOT NULL DEFAULT '' ≤ 200, remote/canada_ok TEXT IN ('yes','no','unknown'), job_type TEXT IN ('contract','part_time','temporary','freelance','full_time','unknown'), pay_low/pay_high INTEGER NULL (cents per unit, ≥ 0, low ≤ high), pay_currency TEXT NULL IN ('USD','CAD','OTHER'), pay_unit TEXT IN ('hour','year','unknown'), pay_text TEXT NOT NULL DEFAULT '' ≤ 80, hours_low/hours_high INTEGER NULL 1–80, excerpt TEXT NOT NULL DEFAULT '' ≤ 4000, first_seen, last_seen, closed_at NULL, status TEXT IN ('new','saved','skipped','applied','interview','offer','rejected','filtered','expired'), status_at, applied_at NULL, resume_label NULL 1–40, batch_id INTEGER NULL REFERENCES job_scan_runs, batch_rank INTEGER NULL ≥ 1, merged_into INTEGER NULL REFERENCES job_leads, follow_up_task_id INTEGER NULL REFERENCES tasks)`; CHECKs: `(status IN ('applied','interview','offer')) <= (applied_at IS NOT NULL)` and `(applied_at IS NULL) = (resume_label IS NULL)`; `(origin = 'pasted') = (external_id IS NULL)`; `UNIQUE (origin, external_id)`; index on `(status, batch_id)`.
- `job_lead_scores(lead_id REFERENCES job_leads, profile_id, score INTEGER 0–100, verdict IN ('strong','maybe','skip'), matched_json, gaps_json, flags_json (json_valid each), scored_at, PRIMARY KEY (lead_id, profile_id))`. Rescoring replaces the row (scores aren't history; header comment says so).
- `job_platform_events(id, platform_id, stage IN the five stages, next_step TEXT NOT NULL DEFAULT '' ≤ 100 trimmed, snoozed_until TEXT NULL date, changed_at)`.
- Never-delete triggers on `job_leads`, `job_scan_runs`, `job_platform_events`.

- [ ] **Step 1: Failing tests:** good rows insert in each table; refused: bad status, `applied` without `applied_at`, `applied_at` without label, pasted lead with external id, duplicate (origin, external_id), `pay_low > pay_high`, `http://` url, unknown stage, invalid JSON; delete from `job_leads` / `job_platform_events` refused; existing tables still migrate (`tests/test_db.py` passes).
- [ ] **Step 2–4:** run (fail); write the migration with a header comment in the 013 style explaining each table, scores being replaceable, and that public posting text is the only text stored; run (pass) with `tests/test_db.py`.
- [ ] **Step 5: Commit** `Migration 014: Opportunity Office leads, scores, scans and platform stages`

---

### Task 3: Text and pay extraction

**Files:** Create `src/aicity/jobs_text.py`; Test `tests/test_jobs_text.py`

**Interfaces:**
- `@dataclass(frozen=True) class Pay: low: int | None; high: int | None; currency: str | None; unit: str; text: str` (cents; unit `hour|year|unknown`; `text` is the matched snippet ≤ 80 chars, `""` when none)
- `def parse_pay(text: str) -> Pay`
- `@dataclass(frozen=True) class Facts: remote: str; canada_ok: str; job_type: str; hours: tuple[int, int] | None`
- `def read_facts(title: str, location: str, text: str, location_ok: tuple[str, ...]) -> Facts`
- `def normalise_title(title: str) -> str`, `def normalise_company(name: str) -> str` (rules in Decisions)

- [ ] **Step 1: Failing tests (exact values):**
  - `parse_pay("$65 – $125 per hour")` → `Pay(6500, 12500, "USD", "hour", "$65 – $125 per hour")`
  - `"$40/hr"` → (4000, 4000, USD, hour); `"up to $50/hr"` → (None, 5000, USD, hour); `"$30-45 CAD per hour"` and `"CA$30–45/hr"` → (3000, 4500, CAD, hour)
  - `"$120,000/year"` and `"$40k"` → unit `year` (40k as 4_000_000 cents), never hour
  - `"£25/hr"`, `"€30 per hour"` → currency `OTHER`; `"Competitive pay"` → `Pay(None, None, None, "unknown", "")`
  - `read_facts`: location "Remote - Canada" → remote yes, canada yes; "Remote (US only)" → canada no; "Remote" with no country → canada unknown; text "full-time" → job_type full_time; "10-20 hours per week" → hours (10, 20); "contract" in title → contract
  - `normalise_title("AI Trainer (Remote, Contract) – Canada")` == `normalise_title("ai trainer")`
- [ ] **Step 2:** run → fail. **Step 3:** implement with compiled regexes; `parse_pay` takes the first match; a figure with `k` or ≥ 1000 without `/hr` wording is yearly. **Step 4:** run → pass.
- [ ] **Step 5: Commit** `Opportunity Office: read pay and facts from posting text`

---

### Task 4: Rules scoring

**Files:** Create `src/aicity/jobs_score.py`; Test `tests/test_jobs_score.py`

**Interfaces:**
- `@dataclass(frozen=True) class Posting: title: str; company: str; location: str; text: str; pay: Pay; facts: Facts`
- `@dataclass(frozen=True) class Score: keep: bool; drop_reason: str | None; score: int; verdict: str; matched: tuple[str, ...]; gaps: tuple[str, ...]; flags: tuple[str, ...]`
- Flags: `"pay_not_listed"`, `"straddles_floor"`, `"canada_unknown"`. Drop reasons: `"not_remote"`, `"not_canada"`, `"full_time"`, `"below_floor"`, `"excluded_word"`.
- `def background_for(profile: JobProfile) -> tuple[str, ...]` (the connection point; returns `profile.skills` now; docstring says Flight School's Archive replaces it)
- `def score_posting(posting: Posting, profile: JobProfile, usd_rate: Decimal | None) -> Score` (`usd_rate` = CAD per USD)

- [ ] **Step 1: Failing tests:** each drop reason (one test each); a $65–125 USD remote Canada contract with 5 matching skills and a title word → score 100, strong; a $35 USD posting → pay part 15; $25–35 → kept, `straddles_floor`, pay part 8; CAD $45/hr at rate 1.40 → $32.14 USD → pay part 15; CAD pay with `usd_rate=None` → `pay_not_listed`; yearly pay → `pay_not_listed`; gaps capped at 5 and never include a background skill; `background_for` returns the profile's skills.
- [ ] **Step 2:** run → fail. **Step 3:** implement (weights and thresholds from Decisions; whole-word matching with `re.escape` and `\b`). Comment crediting career-ops for the clear skip verdict. **Step 4:** run → pass.
- [ ] **Step 5: Commit** `Opportunity Office: rules scoring against a profile`

---

### Task 5: Leads and platform store

**Files:** Create `src/aicity/jobs_store.py`; Test `tests/test_jobs_store.py`

**Interfaces:**
- `class JobsError(ValueError)`, `class JobsNotFound(LookupError)`, `class JobsConflict(Exception)`
- `@dataclass(frozen=True) class LeadView: id, origin, url, title, company, location, remote, canada_ok, job_type, pay_low_usd: int | None, pay_high_usd: int | None, pay_text, status, applied_at, resume_label, score: int | None, verdict: str | None, matched: list[str], gaps: list[str], flags: list[str], closed: bool`
- `@dataclass(frozen=True) class Inbox: new: list[LeadView]; earlier: list[LeadView]; more: list[LeadView]; saved: list[LeadView]; applied: list[LeadView]; closed: list[LeadView]`
- `@dataclass(frozen=True) class PlatformView: id: str; name: str; url: str; stage: str; next_step: str; snoozed_until: str | None; changed_at: str | None`
- `class JobsStore(conn, settings: JobsSettings, *, clock=utc_now, usd_rate: Decimal | None = None)`:
  - `paste(self, *, url: str | None, title: str, company: str, location: str, text: str, profile_id: str) -> LeadView` (extracts with Task 3, scores with Task 4; a failed filter still saves as `new` with the drop reason added to `flags`; joins a same role per Decisions or same url, filling only empty fields)
  - `list_leads(self, profile_id: str) -> Inbox` (reads only)
  - `set_status(self, lead_id: int, status: str, resume_label: str | None = None) -> LeadView`
  - `skip_rest(self, profile_id: str) -> int` (skips the New list; returns how many)
  - `badge_counts(self, profile_id: str) -> dict[str, int]` (`{"new": n}`; PR 4 adds follow-ups)
  - `platforms(self) -> list[PlatformView]` (settings order)
  - `set_platform(self, platform_id: str, *, stage: str | None = None, next_step: str | None = None, snooze: bool = False) -> PlatformView` (appends an event; unchanged values carried forward; `snooze` sets `snoozed_until` = today + 28 days)
  - `nudges(self, limit: int = 2) -> list[PlatformView]`

- [ ] **Step 1: Failing tests:** paste saves and scores; paste of a below-floor role saves with `below_floor` flag; Review Focus 3 (`test_pasting_same_role_twice_joins_first`, by url and by company + title, fills only empty fields); New / Earlier / More split with two fake batches inserted directly; Review Focus 5 (`test_skip_rest_only_touches_new`, `test_skip_rest_on_empty_list_is_zero`); legal and illegal status changes (applied → new is `JobsConflict`); applying without a label is `JobsError`; unknown lead is `JobsNotFound`; platform start stage from settings, a change appends one event row, snooze hides it from `nudges` until 28 days pass, at most 2 nudges, oldest first; `list_leads` writes nothing (`conn.total_changes` unchanged).
- [ ] **Step 2:** run → fail. **Step 3:** implement; writes in one transaction each, following `grocery.py`. **Step 4:** run → pass.
- [ ] **Step 5: Commit** `Opportunity Office: leads and platform store`

---

### Task 6: A lock per building

**Files:** Modify `src/aicity/vault_lock.py`, `src/aicity/main.py`; Test `tests/test_vault_lock.py`, `tests/test_main.py` (or the existing mode-switch test file)

**Interfaces:**
- `VaultLock(ask=ask_owner, *, place: str = "The Vault")`. The refusal message uses `f"Touch ID didn't confirm. {place} stays locked."`. Existing callers unchanged.
- `app.state.jobs_lock = VaultLock(ask, place="Opportunity Office")`; `change_mode` forgets it too.

- [ ] **Step 1: Failing tests:** refusal message names Opportunity Office for the jobs lock; a mode switch makes an earlier jobs key stop working; a Vault key doesn't open the jobs lock and vice versa.
- [ ] **Step 2–4:** run (fail), implement, run (pass) with the Vault lock tests.
- [ ] **Step 5: Commit** `Touch ID lock for Opportunity Office`

---

### Task 7: `/api/jobs` routes

**Files:** Create `src/aicity/jobs_routes.py`; Modify `src/aicity/main.py` (include routers); Test `tests/test_jobs_routes.py`; add the GETs to `tests/test_get_routes_read_only.py`

**Interfaces** (header `X-Jobs-Key`, 403 `"Opportunity Office is locked."`; 400 settings missing `[jobs]` → `"Opportunity Office isn't set up yet."`; 404/409/422 from store errors; profile = first active profile unless `?profile=`):
- `POST /api/jobs/unlock` → `{"key": str | null}` (null in Sample)
- `GET /api/jobs/badge` → `{"text": str | null}`: `"4 new leads"` / `"1 new lead"` / null. Unlocked.
- `GET /api/jobs/leads` → `Inbox` as JSON plus `{"profile": {"id", "name"}, "rate": {"value", "date"} | null}`
- `POST /api/jobs/leads` (paste) body `{url?, title, company, location?, text}` → 201 lead
- `POST /api/jobs/leads/{id}/status` body `{status, resume_label?}` → lead
- `POST /api/jobs/leads/skip-rest` → `{"skipped": n}`
- `GET /api/jobs/platforms` → `{"platforms": [...], "nudges": [...]}`
- `PUT /api/jobs/platforms/{id}` body `{stage?, next_step?, snooze?}` → platform

- [ ] **Step 1: Failing tests:** Review Focus 2 (`test_every_locked_route_needs_the_key`, parametrised over all routes but unlock and badge, no key and a stale key → 403); `test_badge_names_nothing` (badge with a lead whose company is "Zeta Labs" contains only the count); Sample mode needs no key; paste → 201 and appears in `GET leads` New; status change and illegal change → 409; skip-rest; platform PUT; missing `[jobs]` → 400; rate comes from `fx.latest_rate`.
- [ ] **Step 2–4:** run (fail), implement in the `vault_routes.py` style (`_require_key` dependency on a router, a separate unlock/badge router), run (pass); full suite.
- [ ] **Step 5: Commit** `Opportunity Office: routes`

---

### Task 8: Sample mode

**Files:** Modify `src/aicity/sample_data.py`, `src/aicity/jobs_routes.py` (Sample uses `SAMPLE_JOBS`, never the private settings); Test `tests/test_sample_data.py`

**Interfaces:** `SAMPLE_JOBS: JobsSettings` (made-up profile, one source, four platforms; like `SAMPLE_PAY_SCHEDULES`). `def seed_jobs(conn: sqlite3.Connection, now: datetime) -> bool`, called from `seed`. Made-up companies only ("Nimbus Data", "Orbit Labs", ...). Seeds: one finished scan run, 6 scanned leads in it (ranks 1–6, mixed verdicts and flags), 1 lead in an older batch (Earlier), 1 pasted, 1 saved, 2 applied (one 12 days ago), 1 interview, 1 skipped; platform events making one active, one in assessment with a next step, the rest from settings.

- [ ] **Step 1: Failing test:** `test_sample_jobs_seed` (counts per Inbox list; platform stages; seeding twice adds nothing).
- [ ] **Step 2–4:** run (fail), implement, run (pass).
- [ ] **Step 5: Commit** `Sample mode: Opportunity Office leads and platforms`

---

### Task 9: Finish

- [ ] Clear caches, run the full suite, `ruff check`, `ruff format --check src tests scripts`, type check as in CI, gitleaks over full history, blocked words over every tracked file.
- [ ] Live check: start a throwaway Sample server (port 8799, temporary `AICITY_DATA_DIR`, `Host`/`Origin` headers as in the session-13 note) and call each route once.
- [ ] `graphify update .`
