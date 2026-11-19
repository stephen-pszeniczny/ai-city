# Hand-entered main-job pay and the statement reminder: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> Public file. Generic names only; real names, amounts and matching words never appear here.

**Goal:** Main-job pay can be typed in on payday ("not yet confirmed"); the month-end statement confirms it; a "Statement due" badge and a once-a-month reminder start on the 8th.

**Architecture:** A new `main_job_payments` table (migration 006) holds every main-job pay, typed or imported, with an optional link to the deposit that confirms it. A new pure rule in `income_match.py` proposes links at import, and `confirm_import` links, adds or skips. A small `statement_reminder.py` module, called from the existing reminder loop for Personal only, makes one `statement` notification per month (migration 007 widens the notifications table). That notification then flows through the existing shuttle, ticker and Mac notification path.

**Tech Stack:** Python 3 + FastAPI + SQLite (STRICT tables, numbered SQL migrations), pytest; React + TypeScript, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-19-hand-entered-pay-design.md`. Read it with this plan.

**Branch:** `vault-hand-entered-pay` off `main`.

## Global Constraints

- Money is integer cents everywhere; no floats in Python.
- Nothing is deleted: new tables get a `BEFORE DELETE … RAISE(ABORT)` trigger. The old `main_job_pay` table stays in place, unused.
- GET routes never write.
- Sample mode never goes online and never reads the private settings.
- Real names and matching words never appear in tracked files, tests or fixtures (fixtures are invented).
- Link rule: within **3 days** of the typed date and within **1%** of the typed net.
- When linked: the **statement's amount wins**; the pay **keeps the typed date**.
- Badge "Statement due" from day `income.statement_due_day` (default **8**, was 5) until a confirmed import covers a day of last month.
- Reminder: on that day at `tasks.reminder_time`, if last month isn't imported: one notification per month, Personal only, text "Time to import last month's chequing statement".
- `income.statement_due_day` is **optional** in `settings.toml`. Steve's private file doesn't have it, and `_exact_keys` must not reject a file without it.
- The Vault's existing side-work link rule (7 days, 5%) is unchanged.

## Review Focus

1. **Typed net with a typo (more than 1% off):** no link is proposed. Steve must still be able to link it by hand at review. Otherwise "add as new" counts that pay twice. Test: `test_confirm_links_a_pay_that_was_not_proposed` (Task 4).
2. **The same typed pay chosen for two deposits in one confirm:** refused with a clear message, nothing stored. Test: `test_confirm_refuses_one_pay_linked_twice` (Task 4).
3. **Steve's current settings file has no `statement_due_day`:** it still loads, with day 8. Test: `test_statement_due_day_is_optional_and_defaults_to_8` (Task 1).
4. **Deposit posted the day before a month starts, for pay typed on the 1st:** the pay counts in the typed month. Test: `test_view_counts_linked_pay_in_the_typed_month` (Task 5).
5. **Dismissing the statement reminder while still not imported:** it doesn't come back that month, even if the reminder time is changed. Test: `test_statement_reminder_once_per_month_even_after_dismiss_or_time_change` (Task 6).

---

### Task 1: Statement due day setting, and the badge from the 8th

**Files:**
- Modify: `src/aicity/settings.py` (`IncomeSettings`, `_income`)
- Modify: `src/aicity/income.py` (new `IncomeStore.covers_month_before`)
- Modify: `src/aicity/income_view.py` (drop `STATEMENT_DUE_DAY`; `vault_badge` takes the day)
- Modify: `src/aicity/vault_routes.py` (`badge` passes `income.statement_due_day`)
- Modify: `src/aicity/sample_data.py` (`SAMPLE_INCOME` gets `statement_due_day=8`)
- Modify: `settings.example.toml` (commented `# statement_due_day = 8` under `[income]`)
- Test: `tests/test_settings.py`, `tests/test_income_view.py`

**Interfaces:**
- Produces: `IncomeSettings.statement_due_day: int` (field with default `8`, last in the dataclass).
- Produces: `IncomeStore.covers_month_before(today: date) -> bool`: True when a stored import's `[first_day, last_day]` overlaps the calendar month before `today`. The logic moves out of `vault_badge`.
- Produces: `vault_badge(side, income, schedules, today, due_day: int) -> str | None`.

- [ ] **Step 1: Write the failing tests**
  - `test_statement_due_day_is_optional_and_defaults_to_8`: an `[income]` table without the key loads with `statement_due_day == 8`.
  - `test_statement_due_day_is_read`: `statement_due_day = 10` gives `10`.
  - `test_statement_due_day_out_of_range_is_refused`: `0`, `29`, `"8"` and `8.5` each raise `SettingsError` with a message containing `income.statement_due_day must be a whole number from 1 to 28`.
  - Rename `test_badge_statement_due_from_the_fifth` to `test_badge_statement_due_from_the_due_day`: with `due_day=8`, no import → day 7 gives `None`, day 8 gives `"Statement due"`; with an import covering one day of last month, day 8 gives `None`.
  - `test_covers_month_before_handles_january`: today 2027-01-09; an import 2026-12-31..2026-12-31 → True; an import 2027-01-01..2027-01-05 → False.
- [ ] **Step 2: Run them, and check they fail**
  `.venv/bin/pytest tests/test_settings.py tests/test_income_view.py -q`: they fail with an unknown field or wrong-signature error.
- [ ] **Step 3: Implement.** In `_income`, allow `statement_due_day` as an optional key (required keys stay exact, and an unknown key is still refused). Check with `type(v) is int` the way `_tasks` does, which also rejects `true`/`false`. Then wire `vault_badge` and the route.
- [ ] **Step 4: Run them, and check they pass**
  `.venv/bin/pytest tests/test_settings.py tests/test_income_view.py tests/test_vault_routes.py -q`: all PASS.
- [ ] **Step 5: Commit** `git commit -m "Vault: statement due day setting (default 8); badge uses it"`

---

### Task 2: Migration 006 and the main-job pay store

**Files:**
- Create: `src/aicity/migrations/006_main_job_payments.sql`
- Modify: `src/aicity/income.py` (`MainJobPayRow`, new store methods; `set_main_job_pay` keyed by pay id)
- Test: `tests/test_income_schema.py` (version check now 6, data move), `tests/test_income.py`

**Interfaces:**
- Produces table `main_job_payments`: `id INTEGER PRIMARY KEY`, `paid_on TEXT` (ISO date check), `net_cents INTEGER NOT NULL CHECK BETWEEN 1 AND 100000000`, `gross_cents`, `rrsp_cents`, `match_cents` (same checks as `main_job_pay`), `notes TEXT CHECK (length(notes) <= 500)`, `deposit_id INTEGER UNIQUE REFERENCES deposits (id)`, `created_at` (UTC stamp check). STRICT. Index on `(paid_on, id)`. Trigger `main_job_payments_never_deleted`.
- Data move in the same file: one row per `deposits.kind = 'main_job'`, with `paid_on = posted_on`, `net_cents = amount_cents`, stub fields from `main_job_pay` (LEFT JOIN), `deposit_id = d.id`, `created_at = d.created_at`, in `posted_on, id` order.
- Produces `MainJobPayRow(id: int, paid_on: date, net_cents: int, gross_cents: int | None, rrsp_cents: int | None, match_cents: int | None, notes: str | None, deposit_id: int | None)`, with properties `confirmed -> bool` (`deposit_id is not None`) and `deductions_cents` (unchanged formula).
- Produces on `IncomeStore`:
  - `main_job_pay() -> list[MainJobPayRow]` (now from `main_job_payments`, ordered `paid_on, id`)
  - `unconfirmed_main_job_pay() -> list[MainJobPayRow]`
  - `add_main_job_pay(*, paid_on: date, net_cents: int, gross_cents: int | None, rrsp_cents: int | None, match_cents: int | None, notes: str | None, deposit_id: int | None = None) -> MainJobPayRow`
  - `edit_main_job_pay(pay_id: int, *, paid_on: date | None, net_cents: int | None, gross_cents, rrsp_cents, match_cents, notes) -> MainJobPayRow`. Stub fields replace, as today. `paid_on` and `net_cents` change only when given. On a confirmed pay, a `net_cents` or `paid_on` that differs raises `IncomeError("This pay is confirmed by the statement; its amount and date come from there.")`. Note: the date of a confirmed pay is the typed date, but it still can't be changed once confirmed.
  - `link_main_job_pay(pay_id: int, deposit: Deposit) -> MainJobPayRow`: sets `deposit_id` and `net_cents = deposit.amount_cents`, and keeps `paid_on`. Raises `MainJobPayTaken` (new, subclass of `IncomeError`) if the pay is already confirmed or doesn't exist. The gross check is **not** re-run (the statement is the truth).
- Removes: `set_main_job_pay(deposit_id, …)` (callers move to `edit_main_job_pay` / `add_main_job_pay` in Tasks 4, 5 and 7).
- Validation for add and edit: notes up to `MAX_NOTES`; net ≥ 1; `gross ≥ net + rrsp` when gross is given (same message as today).

- [ ] **Step 1: Write the failing tests**
  - Schema: `test_new_database_reaches_version_6`. `test_006_moves_imported_main_job_pay`: build a db at version 5 with `migrate(conn, load_migrations()[:5])`, insert two main-job deposits (one with `main_job_pay` stub details) and one side-work deposit, then migrate to 6 → two `main_job_payments` rows with matching `paid_on`, `net_cents`, stub fields and `deposit_id`, and `main_job_pay` still has its row. `test_main_job_payments_never_deleted`. `test_one_pay_per_deposit` (a second row with the same `deposit_id` raises `sqlite3.IntegrityError`).
  - Store: `test_add_typed_pay_is_unconfirmed` (`confirmed is False`, listed by `unconfirmed_main_job_pay`). `test_link_keeps_typed_date_and_takes_statement_amount` (typed 2026-03-20 / 150000, deposit 2026-03-19 / 150900 → `paid_on == date(2026,3,20)`, `net_cents == 150900`, `confirmed`). `test_link_twice_is_refused` (`MainJobPayTaken`). `test_edit_typed_net_and_date_while_unconfirmed`. `test_edit_confirmed_amount_is_refused`. `test_edit_confirmed_stub_details_still_allowed`. Update the existing `test_deposit_and_main_job_pay`, `test_stub_details_*` and `test_gross_below_net_is_refused` to the new methods.
- [ ] **Step 2: Run them, and check they fail**
  `.venv/bin/pytest tests/test_income_schema.py tests/test_income.py -q`: FAIL (no table, no methods).
- [ ] **Step 3: Write the migration and the store methods.** Writes go through `with_transaction(self._conn, work, immediate=True)` the way `set_main_job_pay` does today. Fix `test_real_migration_files_are_numbered_correctly` and any other test that asserts the version count.
- [ ] **Step 4: Run them, and check they pass.** Then run the whole backend suite, which shows the callers Tasks 4, 5 and 7 will fix.
  `.venv/bin/pytest tests/test_income_schema.py tests/test_income.py -q`: PASS. `.venv/bin/pytest -q`: callers of `set_main_job_pay` fail (expected until Task 5). Note which ones.
- [ ] **Step 5: Commit** `git commit -m "Vault: main_job_payments table (migration 006) and typed-pay store"`

---

### Task 3: The main-job link rule

**Files:**
- Modify: `src/aicity/income_match.py` (docstring rule list plus new function)
- Test: `tests/test_income_match.py`

**Interfaces:**
- Produces constants `MAIN_LINK_DAYS = 3` and `MAIN_LINK_TOLERANCE = Decimal("0.01")`.
- Produces `TypedPay(pay_id: int, paid_on: date, net_cents: int)` (frozen dataclass).
- Produces `MainJobProposal(row: StatementRow, kind: Literal["link", "new"], pay_id: int | None = None)`.
- Produces `propose_main_job(rows: list[StatementRow], typed: list[TypedPay]) -> list[MainJobProposal]`. Rows go oldest first (`day, line`). A typed pay fits when `abs((row.day - paid_on).days) <= 3` and `abs(amount - net) <= 0.01 * net`. When several fit, the closest amount wins, then the closest day, then the lower `pay_id`. Each typed pay is used once. Otherwise the kind is `"new"`. Output follows input order.

- [ ] **Step 1: Write the failing tests**
  - `test_main_job_deposit_a_day_early_links` (deposit 03-19, typed 03-20, same amount → link).
  - `test_main_job_link_edges`: 3 days apart links, 4 days doesn't; exactly 1% links, 1% + 1 cent doesn't.
  - `test_main_job_two_paydays_each_link_once` (two typed pays two weeks apart, two deposits → each linked to its own).
  - `test_main_job_closest_amount_wins`.
  - `test_main_job_no_typed_pay_is_new`.
- [ ] **Step 2: Run them, and check they fail**
  `.venv/bin/pytest tests/test_income_match.py -q`: FAIL (ImportError).
- [ ] **Step 3: Implement `propose_main_job`.** Keep it pure; `_close` stays the 5% helper for side work, and the 1% check gets its own.
- [ ] **Step 4: Run them, and check they pass**
  `.venv/bin/pytest tests/test_income_match.py -q`: PASS.
- [ ] **Step 5: Commit** `git commit -m "Vault: main-job link rule (3 days, 1%)"`

---

### Task 4: Import preview and confirm link, add or skip main-job deposits

**Files:**
- Modify: `src/aicity/statement_import.py` (`build_preview`, `MainJobChoice`, `confirm_import`)
- Modify: `src/aicity/vault_routes.py` (`MainJobIn` gains `action`, `pay_id`)
- Test: `tests/test_statement_routes.py` (and the existing import tests that build `MainJobChoice`)

**Interfaces:**
- Consumes: `propose_main_job`, `TypedPay` (Task 3); `IncomeStore.unconfirmed_main_job_pay`, `add_main_job_pay`, `link_main_job_pay`, `MainJobPayTaken` (Task 2).
- Preview body changes:
  - each `main_job[]` item gains `"proposal": {"kind": "link" | "new", "pay_id": int | None, "pay": {"paid_on": str, "net_cents": int} | None}`
  - the body gains `"typed_pay": [{"id", "paid_on", "net_cents"}]`, every unconfirmed typed pay, for linking by hand.
- `MainJobChoice(ref, action: str, pay_id: int | None, gross_cents, rrsp_cents, match_cents, notes)`, where `action` is one of `new | link | skip`.
- `MainJobIn`: `action: Literal["new", "link", "skip"] = "new"`, `pay_id: int | None = None`.
- Confirm behaviour:
  - `new` → deposit stored, then `add_main_job_pay(paid_on=row.day, net_cents=row.amount_cents, …stub fields, deposit_id=d.id)`. A main-job deposit with no choice sent is also `new`, as today.
  - `link` → deposit stored, then `link_main_job_pay(pay_id, d)`. Stub fields in the choice are ignored (they're edited in the Income app). `pay_id` is required: `SideWorkError("Pick which typed-in pay this deposit confirms.")`. The pay can be any unconfirmed pay, not only the proposed one.
  - `skip` → not stored, counted in `skipped`.
  - The same `pay_id` on two choices → `SideWorkError("One typed-in pay can only be confirmed by one deposit.")`, checked before the transaction.
  - `MainJobPayTaken` inside the transaction → `ImportConflict("That pay was confirmed meanwhile. Upload the statement again.")`. Everything rolls back.

- [ ] **Step 1: Write the failing tests** (through the routes, the way `test_statement_routes.py` does)
  - `test_preview_proposes_link_to_typed_pay`: a typed pay on day D, a CSV main-job deposit on D−1 with the same amount → `proposal.kind == "link"`, the matching `pay_id`, and `typed_pay` lists it.
  - `test_confirm_link_confirms_typed_pay`: after confirm, the pay is `confirmed`, keeps date D, and takes the deposit amount; there's still only one main-job pay row.
  - `test_confirm_links_a_pay_that_was_not_proposed` (Review Focus 1): typed net 2% off → proposal `new`; confirming with `action="link"`, `pay_id` succeeds; one row, and net = deposit.
  - `test_confirm_refuses_one_pay_linked_twice` (Review Focus 2): two deposits both linked to one `pay_id` → 400, and no deposits or imports stored.
  - `test_confirm_link_to_already_confirmed_pay_conflicts`: → 409, and nothing stored.
  - `test_confirm_skip_main_job_deposit`: not stored, `skipped == 1`.
  - `test_confirm_new_main_job_deposit_with_stub_details` (replaces the existing stub-details-at-import test).
- [ ] **Step 2: Run them, and check they fail**
  `.venv/bin/pytest tests/test_statement_routes.py -q`: FAIL.
- [ ] **Step 3: Implement it in `build_preview` and `confirm_import`, and update `MainJobIn` and `confirm_statement`.**
- [ ] **Step 4: Run them, and check they pass**
  `.venv/bin/pytest tests/test_statement_routes.py tests/test_income_match.py tests/test_income.py -q`: PASS.
- [ ] **Step 5: Commit** `git commit -m "Vault import: link main-job deposits to typed-in pay; add or skip"`

---

### Task 5: Income view and the Add pay / edit routes

**Files:**
- Modify: `src/aicity/income_view.py` (main-job rows from `main_job_payments`)
- Modify: `src/aicity/vault_routes.py` (POST `/api/vault/income/main-job`; PATCH `/main-job/{pay_id}`)
- Test: `tests/test_income_view.py`, `tests/test_vault_routes.py`

**Interfaces:**
- Consumes: `IncomeStore.main_job_pay`, `add_main_job_pay`, `edit_main_job_pay` (Task 2).
- View: month totals use `paid_on`. Each `main_job_pay[]` item is `{"id", "day" (= paid_on), "net_cents", "gross_cents", "rrsp_cents", "match_cents", "deductions_cents", "notes", "confirmed": bool}`; `deposit_id` is gone. Unconfirmed pay counts toward the goal. The "gross missing" flag is unchanged.
- `POST /api/vault/income/main-job` body `MainJobAdd`: `paid_on: Day`, `net: Money` (required, > 0), `gross`, `rrsp`, `match`, `notes` (optional). Returns 201 with the row in the view's item shape.
- `PATCH /api/vault/income/main-job/{pay_id}` body `MainJobEdit`: adds `paid_on: Day | None = None` and `net: Money = None`. Returns the row in the view's item shape. An `IncomeError` gives 400 through the existing handler. An unknown id gives 404 (`IncomeError` subclass `MainJobPayNotFound`, mapped in `register`).

- [ ] **Step 1: Write the failing tests**
  - `test_view_typed_pay_counts_and_is_unconfirmed`.
  - `test_view_counts_linked_pay_in_the_typed_month` (Review Focus 4): typed 2026-04-01, linked to a deposit posted 2026-03-31 → counted in `2026-04`, and not in March.
  - `test_add_main_job_pay_route` (201, then shows in GET `/api/vault/income` with `confirmed: false`).
  - `test_add_main_job_pay_needs_net` (422) and `test_add_main_job_pay_gross_below_net` (400).
  - `test_edit_main_job_pay_route_by_pay_id`, `test_edit_unknown_pay_is_404`, `test_edit_confirmed_net_is_400`.
  - Both routes need the Vault key: the same 401/403 as the existing PATCH (copy that test's pattern).
- [ ] **Step 2: Run them, and check they fail**
  `.venv/bin/pytest tests/test_income_view.py tests/test_vault_routes.py -q`: FAIL.
- [ ] **Step 3: Implement it.** Then run the full backend suite and fix the remaining `set_main_job_pay` callers, except `sample_data.py` (Task 7). If a Sample test blocks here, switch `seed_income` to `add_main_job_pay(..., deposit_id=d.id)` now and leave the typed-pay addition for Task 7.
- [ ] **Step 4: Run them, and check they pass**
  `.venv/bin/pytest -q`: all PASS.
- [ ] **Step 5: Commit** `git commit -m "Vault: Add pay route; income view shows typed and confirmed main-job pay"`

---

### Task 6: The monthly statement reminder

**Files:**
- Create: `src/aicity/migrations/007_statement_notifications.sql`
- Create: `src/aicity/statement_reminder.py`
- Modify: `src/aicity/reminder_loop.py` (call it for Personal)
- Modify: `frontend/src/api.ts` (`NotificationItem.kind: "reminder" | "statement"`)
- Test: `tests/test_statement_reminder.py` (new), `tests/test_reminder_loop.py`, `tests/test_notifications.py` (rows survive 007)

**Interfaces:**
- Migration 007 rebuilds `notifications`, because SQLite can't change a CHECK in place. It creates `notifications_new` with the same columns, `kind IN ('reminder', 'statement')`, the existing reminder check, `CHECK (kind <> 'statement' OR task_id IS NULL)` and `UNIQUE (kind, task_id, due_at)`. Then it copies every row with ids kept, drops the old table (nothing references it), renames, and recreates `notifications_active`. It adds `CREATE UNIQUE INDEX notifications_one_statement_a_month ON notifications (substr(due_at, 1, 7)) WHERE kind = 'statement'`.
- `STATEMENT_TITLE = "Time to import last month's chequing statement"`.
- `check_statement_reminder(conn: sqlite3.Connection, now_local: datetime, due_day: int, reminder_time: time, clock_utc: datetime) -> int`:
  - If last month is covered (`IncomeStore.covers_month_before`), it clears active `statement` notifications (`cleared_at`) and returns 0.
  - Else, if `now_local.day >= due_day` and `now_local.time() >= reminder_time`, it runs `INSERT OR IGNORE` with kind `statement`, `task_id NULL`, the title, and `due_at = f"{YYYY-MM}-{due_day:02d}T{HH:MM}"`, then returns the rowcount.
  - It runs in one `with_transaction(..., immediate=True)`.
- `check_all_databases(clock, local_tz=None, notify=None, load=load_settings)`: for `DbKind.PERSONAL` only, after `check_reminders`, it loads settings and calls `check_statement_reminder`. It notes `before = store.last_id()` before both, so `created_after` hands the statement notification to `notify` too. A `SettingsError` or `OSError` from `load` is logged by type only, and task reminders are still made.
- No change to `mac_messages.py`: one new notification gives "Reminder" + the title, which is the wording the spec asks for.

- [ ] **Step 1: Write the failing tests**
  - `test_007_keeps_existing_notifications` (a reminder row survives with the same id and fields).
  - `test_statement_reminder_fires_on_due_day_at_reminder_time`: day 8 at 08:59 → 0; at 09:00 → 1 (kind `statement`, the title, `due_at` `…-08T09:00`).
  - `test_statement_reminder_not_before_due_day` (day 7 → 0).
  - `test_statement_reminder_once_per_month_even_after_dismiss_or_time_change` (Review Focus 5): fire, dismiss, check again → 0; check with `reminder_time` 10:00 later that day → 0.
  - `test_statement_reminder_cleared_by_import` (an active one gets `cleared_at` once an import covers last month).
  - `test_statement_reminder_fires_again_next_month`.
  - Loop: `test_statement_reminder_only_in_personal` (both db files exist; the Sample one gets none). `test_statement_reminder_goes_to_mac_notify` (`notify` receives it). `test_bad_settings_still_makes_task_reminders` (`load` raises `SettingsError` → task reminder made, warning logged).
- [ ] **Step 2: Run them, and check they fail**
  `.venv/bin/pytest tests/test_statement_reminder.py tests/test_reminder_loop.py tests/test_notifications.py -q`: FAIL.
- [ ] **Step 3: Write the migration and the module, and wire up the loop.** Update the docstring at the top of `notifications.py` and the header comment in 007 so the list of kinds is right. The "clear reminders whose task no longer wants them" update in `check_reminders` is limited to `kind = 'reminder'`, so it leaves statement rows alone; a test should confirm it. The 90-day delete may remove old statement rows, which is fine because a past month is never re-made.
- [ ] **Step 4: Run them, and check they pass**
  `.venv/bin/pytest -q` PASS; `cd frontend && npm run typecheck` PASS.
- [ ] **Step 5: Commit** `git commit -m "Reminders: monthly statement reminder (migration 007), Personal only"`

---

### Task 7: Sample mode shows a typed, unconfirmed pay; the demo statement confirms it

**Files:**
- Modify: `src/aicity/sample_data.py` (`seed_income`, `build_sample_statement`)
- Test: `tests/test_sample_data.py`

**Interfaces:**
- Consumes: `add_main_job_pay` (Task 2), the preview `proposal` (Task 4).
- `seed_income`: history pays are created with `add_main_job_pay(..., deposit_id=d.id)` (the newest still has no stub details). It adds one typed, unconfirmed pay on `last_seeded_payday(today) + 14 days` with net `_PAY_NET` and the invented stub details.
- `build_sample_statement`: the main-job row is dated **one day before** that payday (the bank posts early), with the same amount.

- [ ] **Step 1: Write the failing tests**
  - `test_sample_has_one_unconfirmed_typed_pay` (exactly one row with `confirmed is False`, on the expected date).
  - `test_sample_statement_proposes_link_to_typed_pay` (preview the sample CSV through the route → the main-job proposal is `link` to that pay; confirming leaves it confirmed with its typed date).
- [ ] **Step 2: Run them, and check they fail**
  `.venv/bin/pytest tests/test_sample_data.py -q`: FAIL.
- [ ] **Step 3: Implement it.**
- [ ] **Step 4: Run them, and check they pass**
  `.venv/bin/pytest -q`: PASS.
- [ ] **Step 5: Commit** `git commit -m "Sample: a typed-in pay waiting for the demo statement"`

---

### Task 8: Screens: Add pay in the Income app; link, add or skip in the Statements review

**Files:**
- Modify: `frontend/src/api.ts` (`IncomeView.main_job_pay` item shape; `MainJobAdd`; `addMainJob`; `editMainJob(payId, …)` with `paid_on`, `net`; preview `proposal` and `typed_pay`; `ConfirmBody.main_job` `action`, `pay_id`)
- Modify: `frontend/src/vault/income.ts` (pure helpers)
- Modify: `frontend/src/vault/IncomePanel.tsx` (Add pay form; status label; edit date and net while unconfirmed)
- Modify: `frontend/src/vault/StatementsPanel.tsx` (main-job rows: proposal text; Link / Add as new / Skip; pick a typed pay)
- Test: `frontend/tests/income.test.ts`

**Interfaces:**
- Consumes: the routes and shapes from Tasks 4 and 5.
- Produces in `income.ts`:
  - `payStatus(confirmed: boolean): string` → `"✓ confirmed by statement"` or `"not yet confirmed"`.
  - `linkNote(depositCents: number, typedCents: number): string | null` → `null` when they're equal, otherwise `"The statement says $X; you typed $Y. The statement's amount will be used."`, formatted with the panel's existing money formatter.
- Statements review copy for a proposed link: `"Matches the pay you typed in (<date>, <amount>)"`. The default action is the proposal's (`link` with its `pay_id`, or `new`). Choosing Link with no proposal shows a picker of `typed_pay` items; Link is disabled when `typed_pay` is empty. The stub fields show only for Add as new.
- The Add pay form fields are date (defaults to today), net (required), then gross, your RRSP, employer contributions (match + flex) and notes. The labels match the existing stub editor's.

- [ ] **Step 1: Write the failing tests:** `payStatus` both ways, `linkNote` equal (`null`) and different (exact string with formatted amounts).
- [ ] **Step 2: Run them, and check they fail**
  `cd frontend && npm test`: FAIL (no export).
- [ ] **Step 3: Implement the helpers, the API changes and both panels.**
- [ ] **Step 4: Run them, and check they pass**
  `cd frontend && npm test && npm run typecheck && npm run build`: all PASS.
- [ ] **Step 5: Live check in Sample mode** (`scripts/app.py` dev run, or the `run` skill). Check these:
  - Income app shows the typed pay as "not yet confirmed".
  - Add pay works.
  - The demo statement proposes the link.
  - Confirming flips the pay to "✓ confirmed by statement", with the date unchanged.
  - Take screenshots in Sample mode only.
- [ ] **Step 6: Commit** `git commit -m "Vault screens: Add pay; confirm typed pay from the statement review"`

---

### Task 9: Docs and graph

**Files:**
- Modify: `settings.example.toml` (if not done in Task 1), the runbook (how to type in pay on payday and what "not yet confirmed" means; the 8th reminder), the how-it-works doc (main-job pay flow, migrations 006 and 007)
- Run: `graphify update .`

- [ ] **Step 1: Update the docs.** Use generic wording only (no employer names, amounts or matching words).
- [ ] **Step 2: Do the fresh full check from SPEC section 2:**
  - Clear `__pycache__` and `.pytest_cache`.
  - Run `.venv/bin/pytest -q`, the hook tests, `ruff check`, `ruff format --check`, `cd frontend && npm test && npm run typecheck && npm run build`.
  - Run gitleaks over the full history and the blocked-words scan over the tracked files.
- [ ] **Step 3: Commit** `git commit -m "Docs: typed-in main-job pay and the statement reminder"`

After the PR merges, run `scripts/app.py update`, and Steve quits and reopens the app. Then run `scripts/app.py sample-reset` so Sample gets the typed pay. The Personal db migrates on open: check that its main-job pay still shows the same months and totals as before.
