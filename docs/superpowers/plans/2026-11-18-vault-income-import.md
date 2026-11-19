# The Vault, part B: statement import, matching and income cards, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import a chequing statement CSV, propose matches for main-job and side-work deposits, store only confirmed income, and show monthly income against the goal in a new Income app, with a counts-only belt badge.

**Architecture:**
- **Pure modules:** `statement_csv.py` reads and classifies rows; `income_match.py` proposes matches; `income_view.py` builds the Income screen.
- **Storage:** migration 005 extends part A's tables.
- **Routes:** `vault_routes.py` gains preview and confirm (the CSV arrives as the raw request body, so no new dependency) and keeps the parsed rows in memory under a token.
- **Frontend:** two new apps on the Vault computer (Statements, Income), plus the bonus checkbox and notes on side-work payments.

**Tech Stack:** Python 3.13, FastAPI, SQLite, pytest; React + TypeScript, plain SVG charts, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-18-vault-income-import-design.md` (part A's spec and code are the base: `side_work.py`, `side_work_math.py`, `fx.py`, `vault_routes.py`, `vault_lock.py`).

## Global Constraints

- Real names (employer, platform, bank) never appear in tracked files. Code and tests use `main_job`, `platform_a` and invented names like "Day job" and "Nimbus Labs".
- Money is integer cents with `ROUND_HALF_UP`. Rounding happens only in `side_work_math.py`.
- Never stored: the statement file, spending rows, balances, descriptions, skipped rows.
- Every new route is behind part A's lock (`_require_key`) except `GET /api/vault/badge`, which returns counts only.
- GET routes never write (`tests/test_get_routes_read_only.py` covers new ones). Tests never touch the network. Sample mode never goes online and never uses private settings.
- Nothing is deleted. Notes are at most 500 characters. Error messages name the line or field, never row content.
- Test CSVs are generated in test code, never copied from real statements.
- After code changes: `graphify update .`.

## Review Focus

1. **The same statement imported twice, or two overlapping months:** every row already stored is counted as "already imported" and nothing doubles. Test in Task 5.
2. **Messy CSV:** a byte-order mark, capitalised headers, a quoted description with commas, blank lines, an amount like `1,234.56`, a credit-card statement with no income rows. The first four are read correctly; a bad amount is a 422 naming the line; no income gives a clear "no deposits found" message. Tests in Task 3.
3. **A deposit for a week already paid by hand:** proposed as a link, so income is not counted twice. Test in Task 4.
4. **Confirm after the token expired, after a mode switch, or after the week got paid in between:** a 409 with a clear message, and nothing is written. Tests in Task 5.
5. **Bonus amount larger than the payment, negative, or given with the checkbox off:** 422 naming `bonus`. Test in Task 6.

---

### Task 1: Settings for deposit matching

**Files:** Modify `src/aicity/settings.py`, `settings.example.toml`. Test `tests/test_settings.py`.

**Interfaces:**
- Produces:
  - `MainJob(name: str, deposit_match: str)` (frozen dataclass) and `Settings.main_job: MainJob | None`.
  - `PaySchedule` gains `deposit_match: str | None = None` (keep it last, with a default, so part A's positional constructions still work).

- [ ] **Step 1: Failing tests:**
  - `[main_job]` with `name` and `deposit_match` is read;
  - `[main_job]` is optional (giving `None`);
  - a blank `deposit_match` is refused, naming `main_job.deposit_match`;
  - an unknown key in `[main_job]` is refused;
  - `pay_schedules.platform_a.deposit_match` is read and stays optional (`None`).
- [ ] **Step 2:** `.venv/bin/pytest tests/test_settings.py -q` → new tests FAIL.
- [ ] **Step 3:** Implement. Matching words are trimmed and kept as typed (matching lowercases both sides). Add commented examples to `settings.example.toml`.
- [ ] **Step 4:** The same command → PASS.
- [ ] **Step 5:** Commit `Settings: deposit matching words for the main job and platforms`.

---

### Task 2: Tables and store changes

**Files:** Create `src/aicity/migrations/005_income.sql`. Modify `src/aicity/side_work.py`. Create `src/aicity/income.py`. Test `tests/test_income_schema.py`, `tests/test_income.py`, `tests/test_side_work.py`.

**Interfaces:**
- Produces:
  - **Migration 005:**
    - Rebuild `side_work_payments` (SQLite can't change a CHECK in place): copy the rows, keep the delete trigger, and set `kind IN ('pay','bonus','extra')`.
    - Add columns: `deposit_id INTEGER UNIQUE REFERENCES deposits(id)`, `includes_bonus INTEGER NOT NULL DEFAULT 0 CHECK (includes_bonus IN (0,1))`, `bonus_cents INTEGER CHECK (bonus_cents BETWEEN 1 AND amount_cents)`, `notes TEXT CHECK (length(notes) <= 500)`, and `CHECK (bonus_cents IS NULL OR includes_bonus = 1)`.
    - New tables:
      - `deposits(id, posted_on, amount_cents > 0, kind IN ('main_job','side_work'), source TEXT, row_key TEXT UNIQUE, import_id REFERENCES statement_imports, created_at)`;
      - `main_job_pay(deposit_id UNIQUE REFERENCES deposits, gross_cents, rrsp_cents, match_cents` (each optional, ≥ 0)`, notes)`;
      - `statement_imports(id, first_day, last_day, kept, duplicates, skipped, spending, created_at)`.
    - Delete triggers on all new tables.
  - **`side_work.py`:**
    - `Payment` gains `deposit_id`, `includes_bonus`, `bonus_cents` and `notes`.
    - `record_payment(..., includes_bonus=False, bonus_cents=None, notes=None, deposit_id=None)`.
    - `edit_payment(payment_id, *, includes_bonus=..., bonus_cents=..., notes=...) -> Payment`.
    - `kind="extra"` needs no entries, like a bonus.
  - **`income.py`:**
    - `IncomeStore(conn, clock)` with `existing_row_keys(keys: set[str]) -> set[str]`, `record_import(...) -> int`, `add_deposit(...) -> Deposit`, `set_main_job_pay(deposit_id, gross_cents, rrsp_cents, match_cents, notes) -> MainJobPay`, `main_job_pay() -> list[MainJobPayRow]` (joined with the deposit) and `imports() -> list[StatementImport]`.
    - Dataclasses `Deposit`, `MainJobPay`, `MainJobPayRow`, `StatementImport`.
  - **`side_work_view` change:**
    - With `includes_bonus`, a group's difference is `received − (expected + bonus_cents)`.
    - With no bonus amount and received above expected, the difference is 0, and `bonus_cad_cents` = received − expected.
    - `extra` payments are listed under `"extras"`, and count toward the month and the set-aside like bonuses.
    - Payment JSON gains `includes_bonus`, `bonus_cents`, `notes`, `deposit_id`.
- [ ] **Step 1: Failing tests:**
  - Part A rows survive the rebuild: insert rows at version 4, migrate, then check every value and that the delete trigger still blocks;
  - `bonus_cents` without `includes_bonus` is refused;
  - a bonus larger than the amount is refused;
  - a 501-character note is refused;
  - the same `row_key` twice is refused;
  - an `extra` payment with entries is a 422;
  - `edit_payment` changes the note and keeps the amount;
  - view: received 15000, expected 14000, `includes_bonus` with no amount → difference 0, bonus 1000;
  - view: with `bonus_cents=500` → difference +500.
- [ ] **Step 2:** `.venv/bin/pytest tests/test_income_schema.py tests/test_income.py tests/test_side_work.py tests/test_db.py -q` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run those tests plus the full suite → PASS.
- [ ] **Step 5:** Commit `Vault: tables for deposits, main-job pay and statement imports`.

---

### Task 3: Reading a statement

**Files:** Create `src/aicity/statement_csv.py`. Test `tests/test_statement_csv.py`.

**Interfaces:**
- Produces:
  - `StatementRow(line: int, day: date, transaction: str, description: str, amount_cents: int, balance_cents: int | None, currency: str)`;
  - `read_statement(data: bytes) -> list[StatementRow]`, which raises `StatementError(message)` naming a line number or a missing header;
  - `row_key(row) -> str` (sha256 hex of the six raw fields, normalised);
  - `classify(rows, main_job: MainJob | None, schedules: dict[str, PaySchedule]) -> Classified`, where `Classified` holds `main_job: list[StatementRow]`, `platform: dict[str, list[StatementRow]]`, `other_income: list[StatementRow]`, `spending: int`, `other_currency: int`.
  - Limits: 2 MB (`MAX_BYTES`) and 20,000 rows.
- [ ] **Step 1: Failing tests** (CSV text written inside the test, invented values):
  - the six headers in any case and order;
  - a byte-order mark;
  - a quoted description containing commas;
  - blank lines skipped;
  - `-12.30` is spending;
  - `1,234.56` is a `StatementError` naming the line;
  - a missing `balance` header is an error;
  - an empty balance is allowed;
  - a USD row counts as `other_currency`;
  - over 2 MB is refused;
  - matching is case-insensitive substring (`"day job pay"` matches `"DAY JOB PAY 123"`);
  - a row matching both main job and a platform goes to the main job;
  - the same row always gives the same `row_key`, and changing the balance changes it.
- [ ] **Step 2:** `.venv/bin/pytest tests/test_statement_csv.py -q` → FAIL.
- [ ] **Step 3:** Implement with the `csv` module and `utf-8-sig` decoding. Amounts reuse the pattern from `side_work_math.money_to_cents`, with an optional leading minus.
- [ ] **Step 4:** The same command → PASS.
- [ ] **Step 5:** Commit `Vault: read and sort chequing statement rows`.

---

### Task 4: Proposing matches

**Files:** Create `src/aicity/income_match.py`. Test `tests/test_income_match.py`.

**Interfaces:**
- Consumes: `pay_period`, `arrival_window`, `expected_cents`, `to_cad_cents` (part A); `StatementRow`.
- Produces:
  - `OpenWeek(schedule_id, start: date, window: tuple[date, date], entry_ids: list[int], expected_by_currency: dict[str, int], partial: bool)`;
  - `HandPayment(payment_id, schedule_id, received_on: date, amount_cad_cents: int)`;
  - `Proposal(row: StatementRow, kind: Literal["week","bonus","link","unmatched"], week_start: date | None, payment_id: int | None, check_amount: bool)`;
  - `propose(deposits: dict[str, list[StatementRow]], weeks: list[OpenWeek], paid: list[HandPayment], rate_for: Callable[[date], Decimal | None]) -> list[Proposal]`, using the spec's rules exactly (window ± 2 days, within 5%, closest amount, earlier week on a tie, each week once, oldest deposit first, bonus within 3 days, link within 3 days and 5%, partial week only when it is the sole window fit).
  - Constants `WINDOW_SLACK_DAYS = 2`, `AMOUNT_TOLERANCE = Decimal("0.05")`, `BONUS_DAYS = 3`.
- [ ] **Step 1: Failing tests** (Saturday-start schedule, release (5, 6), arrival (3, 4)):
  - a deposit 2% under expected inside the window → `week`;
  - 6% off → `unmatched`;
  - 3 days after the window → `unmatched`, 2 days after → `week`;
  - two weeks fit → the closer amount wins, and on equal amounts the earlier week wins;
  - a second smaller deposit 1 day after the pay → `bonus` for that week;
  - a deposit within 3 days and 5% of a hand-typed payment → `link`;
  - a partial week as the only fit → `week` with `check_amount=True`, but `unmatched` when two windows fit;
  - no rate for the day → that week can only be proposed as a sole partial-style fit, with `check_amount=True`;
  - one week is never given to two deposits.
- [ ] **Step 2:** `.venv/bin/pytest tests/test_income_match.py -q` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** The same command → PASS.
- [ ] **Step 5:** Commit `Vault: propose matches for imported deposits`.

---

### Task 5: Preview and confirm routes

**Files:** Create `src/aicity/statement_import.py`. Modify `src/aicity/vault_routes.py`, `src/aicity/main.py` (a mode switch also clears pending imports). Test `tests/test_statement_routes.py`.

**Interfaces:**
- Produces:
  - `PendingImports` (in memory, on `app.state.pending_imports`): `put(rows, classified) -> str` (a `secrets.token_urlsafe(16)` token), `take(token) -> Pending` (raises `ImportExpired` after 15 minutes or when unknown), `clear()`.
  - **Routes** (all behind the lock):
    - `POST /api/vault/statements/preview`: body is the raw CSV, `Content-Type: text/csv`. Returns `{"token", "first_day", "last_day", "main_job": [{"ref", "day", "amount_cents"}], "platform": [{"ref", "day", "amount_cents", "schedule_id", "proposal": {...}}], "other_income": [{"ref", "day", "amount_cents"}], "already_imported": n, "spending": n, "other_currency": n}`. Refs are opaque per-preview ids, and descriptions are never returned. A file with no income rows returns 422 "No deposits found. Is this the chequing statement?".
    - `POST /api/vault/statements/confirm`: body `{"token", "main_job": [{"ref", "gross"?, "rrsp"?, "match"?, "notes"?}], "platform": [{"ref", "action": "week"|"bonus"|"link"|"skip", "week_start"?, "payment_id"?, "includes_bonus"?, "bonus"?, "notes"?}], "other_income": [{"ref", "action": "skip"|"add", "company"?, "notes"?}]}`. Writes in one transaction and returns `{"import_id", "kept", "duplicates", "skipped"}`.
    - `GET /api/vault/statements`: past imports.
  - Rates for deposit days are fetched at preview (Personal only; Sample uses `ensure_sample_rates`).
- [ ] **Step 1: Failing tests:**
  - preview then confirm stores the main-job deposit with its gross and RRSP, links a platform deposit to its week's entries, and records a bonus and an extra;
  - importing the same file again → `already_imported` = all and `kept` 0;
  - an overlapping file keeps only the new rows;
  - a reused or expired token → 409 (fake the clock);
  - a mode switch between preview and confirm → 409;
  - a week paid by hand between preview and confirm → 409 and nothing written;
  - spending rows never appear in the response and nothing about them is stored (check every table);
  - no key in Personal → 403 on all three;
  - a credit-card style file → 422 with the message;
  - over 2 MB → 413.
- [ ] **Step 2:** `.venv/bin/pytest tests/test_statement_routes.py -q` → FAIL.
- [ ] **Step 3:** Implement. Confirm re-checks freshness inside `with_transaction(..., immediate=True)`.
- [ ] **Step 4:** Run the new tests plus the full suite → PASS.
- [ ] **Step 5:** Commit `Vault: statement preview and confirm`.

---

### Task 6: Income view, edits and badge

**Files:** Create `src/aicity/income_view.py`. Modify `src/aicity/vault_routes.py`. Test `tests/test_income_view.py`, `tests/test_vault_routes.py`.

**Interfaces:**
- Produces:
  - `income_view(conn, side_store, income_store, goal_cents: int, income: IncomeSettings, schedules, main_job_name: str | None, today: date) -> dict`:
    - `{"month": {"gross_cents", "net_cents", "gross_missing": bool, "goal_cents", "employer_match_cents", "by_source": [{"key", "name", "cents"}]}`
    - `"months": [6 × {"month": "YYYY-MM", "by_source": [...], "total_cents"}]`
    - `"platforms": [{"id", "name", "hours", "received_cad_cents", "rate_cad_cents" | null}]` (last 3 months)
    - `"set_aside": {"cents", "percent", "is_placeholder"}`
    - `"main_job_pay": [rows with deposit day, net, gross, rrsp, match, deductions, notes]`
  - Routes:
    - `GET /api/vault/income`;
    - `PATCH /api/vault/income/main-job/{deposit_id}` (gross, rrsp, match, notes);
    - `PATCH /api/vault/side-work/payments/{id}` (includes_bonus, bonus, notes);
    - `GET /api/vault/badge` with no lock: `{"text": "2 overdue" | "Statement due" | null}`, following the spec's rules, with no amounts ever.
  - `POST /side-work/payments` (part A) also accepts `includes_bonus`, `bonus` and `notes`.
- [ ] **Step 1: Failing tests:**
  - **Month totals**, with gross 300000, net 210000, RRSP 15000 and match 7500 → gross 300000 + side, the match shown separately and not in the totals, deductions 75000;
  - a missing gross uses the net, with `gross_missing` true;
  - net = main-job net + side − set-aside;
  - the effective rate = received ÷ paid hours;
  - months are filled with zero for empty ones;
  - **badge:** "Statement due" on the 5th with no import covering the previous month, nothing on the 4th, overdue wins, and the badge text never contains `$` or a digit followed by `.`;
  - the badge works without a key in Personal while `/income` needs one;
  - **bonus validation:** a bonus above the payment amount, negative, or given without `includes_bonus` → 422 naming `bonus`; a 501-character note → 422.
- [ ] **Step 2:** `.venv/bin/pytest tests/test_income_view.py tests/test_vault_routes.py -q` → FAIL.
- [ ] **Step 3:** Implement. The goal comes from `settings.goals` (Personal) or `sample_data.SAMPLE_GOAL_CENTS` (Sample).
- [ ] **Step 4:** Run the new tests plus the full suite → PASS.
- [ ] **Step 5:** Commit `Vault: income view, notes, bonus checkbox and badge`.

---

### Task 7: Sample data

**Files:** Modify `src/aicity/sample_data.py`, `src/aicity/vault_routes.py`. Test `tests/test_sample_data.py`, `tests/test_statement_routes.py`.

**Interfaces:**
- Produces:
  - `SAMPLE_MAIN_JOB = MainJob("Day job", "DAY JOB PAY")`, `SAMPLE_GOAL_CENTS`, and `deposit_match="NIMBUS LABS"` on the sample schedule.
  - Seeding (its own once-only key) adds biweekly main-job deposits with some gross and RRSP values, deposits linked to the sample's paid weeks, and one confirmed import.
  - `GET /api/vault/statements/sample.csv` (Sample only; 404 in Personal) builds a fake CSV covering the last 3 weeks: main-job pay, platform pay and a bonus, two spending rows, one unknown deposit, and one USD row.
- [ ] **Step 1: Failing tests:**
  - after seeding, the income view has a non-zero month and 6 months;
  - the sample CSV previews with at least one `week` proposal, one `bonus`, one other income, and spending ≥ 2;
  - the CSV route is 404 in Personal;
  - an older Sample database gets the income data on its next start.
- [ ] **Step 2:** `.venv/bin/pytest tests/test_sample_data.py tests/test_statement_routes.py -q` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** The same command → PASS.
- [ ] **Step 5:** Commit `Sample mode: invented income history and a demo statement`.

---

### Task 8: Frontend: Statements and Income apps, bonus and notes, badge

**Files:**
- Create `frontend/src/vault/StatementsPanel.tsx`, `frontend/src/vault/IncomePanel.tsx`, `frontend/src/vault/charts.tsx`, `frontend/src/vault/income.ts`.
- Modify `frontend/src/api.ts`, `frontend/src/desktop/apps.ts` (Side work, Income and Statements ready; Goals removed), `frontend/src/desktop/Desktop.tsx`, `frontend/src/vault/SideWorkPanel.tsx` (bonus checkbox and notes on Record payment; notes editable on payments), `frontend/src/belt/Labels.tsx` (Vault badge), `frontend/src/belt/built.ts` (add `finance`), `frontend/src/vault/vault.css`.
- Test `frontend/tests/income.test.ts`, `frontend/tests/apps.test.ts`.

**Interfaces:**
- Produces:
  - In `income.ts`: `goalProgress(gross, goal) -> {percent: number, label: string}`, capped visually at 100% with the label showing the real percent; `stackSegments(bySource, goal, height) -> {key, y, h}[]` for the SVG bars; `formatMonth("2026-11") -> "Nov"`.
  - Lock handling reuses part A (`vault()`, `onVaultLocked`). The badge uses a plain request (no key).
- [ ] **Step 1: Failing tests:**
  - `goalProgress(375000, 750000)` → 50, "50% of goal";
  - `goalProgress(900000, 750000)` → percent 120 and a full bar;
  - `stackSegments` heights sum to the total's share of the height;
  - `formatMonth`;
  - `appsFor("finance")` lists `sidework`, `income` and `statements`, all ready.
- [ ] **Step 2:** `cd frontend && npm test` → FAIL.
- [ ] **Step 3:** Implement:
  - The review screen lists each group with its proposal pre-selected, the bonus checkbox with an optional amount, notes, and one "Confirm import" button.
  - Main-job rows have gross, RRSP and match fields.
  - The Income panel shows the month card, the 6-month SVG bars with a goal line, the platform table, the set-aside, and the main-job pay list with edit.
- [ ] **Step 4:** `npm test && npm run typecheck && npm run build` → all pass.
- [ ] **Step 5:** Commit `Vault: Statements and Income apps, bonus checkbox and notes`.

---

### Task 9: Live check and wrap-up

- [ ] **Step 1:** Add `deposit_match` for the main job and the platform to the private settings file (the words Steve gave; never committed).
- [ ] **Step 2:** On a throwaway data folder, in Sample mode:
  - "Try a sample statement" → review → confirm → the Income app shows it;
  - import again → everything is "already imported";
  - check the belt badge;
  - record a payment with the bonus checkbox and a note.
- [ ] **Step 3:** Fresh full check (caches cleared): pytest, ruff check and format, npm test, typecheck, build, gitleaks over full history, blocked words over every tracked file, `graphify update .`.
- [ ] **Step 4:** Runbook: monthly import steps; what "already imported" and "check the amount" mean. Commit, then a whole-branch review, fixes, PR.
