# Older main-job pay checked by hand: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> Public file. Generic wording only.

**Goal:** A one-time migration marks unconfirmed pay dated before the earliest statement import as "checked by hand", which then counts as confirmed everywhere and shows "✓ confirmed (checked by hand)".

**Architecture:** Migration 009 adds `hand_checked_at` and fills it in the same step. `MainJobPayRow` gains `hand_checked`, and `confirmed` becomes "deposit or hand-checked", so every existing lock (edit, remove, link, review choices) follows. The view adds `checked_by_hand`, and `payStatus` picks the label.

**Tech Stack:** SQLite migration, Python, pytest; TypeScript, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-19-hand-checked-older-pay-design.md`

**Branch:** `hand-checked-older-pay` off `main`.

## Global Constraints

- Nothing deleted. No real dates or names in tracked files (tests use invented dates).
- Only the migration ever sets `hand_checked_at`; no store method or route sets it.

## Review Focus

1. **No statement imports yet** → nothing is marked. Test: `test_009_marks_nothing_without_imports`.
2. **Pay dated on or after the earliest import's first day, removed pay, and deposit-confirmed pay** are not marked. Test: `test_009_marks_only_older_unconfirmed_pay`.
3. **A hand-checked pay isn't offered at statement review** and can't be linked. Test: `test_hand_checked_pay_is_not_offered_or_linked`.
4. **Its date and net are locked and it can't be removed; stub details still edit.** Test: `test_hand_checked_pay_is_locked_like_confirmed`.
5. **The message for a locked hand-checked pay doesn't say "by the statement".** Covered in Review Focus 4's assertions.

---

### Task 1: Migration 009 and "checked by hand" everywhere

**Files:**
- Create: `src/aicity/migrations/009_hand_checked_pay.sql`
- Modify: `src/aicity/income.py` (`MainJobPayRow.hand_checked`, `confirmed`, `_pay_rows` select, `unconfirmed_main_job_pay` filter, lock messages worded for both kinds)
- Modify: `src/aicity/income_view.py` (`main_job_pay_json` adds `"checked_by_hand"`)
- Modify: `frontend/src/api.ts`, `frontend/src/vault/income.ts` (`payStatus(confirmed, byHand)`), `frontend/src/vault/IncomePanel.tsx`
- Test: `tests/test_income_schema.py`, `tests/test_income.py`, `frontend/tests/income.test.ts`

**Interfaces:**
- Migration: `ALTER TABLE main_job_payments ADD COLUMN hand_checked_at TEXT CHECK (hand_checked_at IS NULL OR <UTC stamp format>)`, then `UPDATE … SET hand_checked_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE deposit_id IS NULL AND archived_at IS NULL AND paid_on < (SELECT MIN(first_day) FROM statement_imports)`. A NULL subquery marks nothing.
- `MainJobPayRow(..., deposit_id, hand_checked: bool = False)`; `confirmed` = `deposit_id is not None or hand_checked`.
- `unconfirmed_main_job_pay` filter: `deposit_id IS NULL AND hand_checked_at IS NULL`.
- Lock messages: edit → "This pay is confirmed; its amount and date can't change."; remove → "This pay is confirmed, so it stays. Edit its stub details."; link → `MainJobPayTaken("That pay is already confirmed.")`.
- JSON: `"checked_by_hand": bool`. `payStatus(confirmed: boolean, byHand = false)` → `"✓ confirmed (checked by hand)"` when `byHand`.

- [ ] **Step 1: Write the failing tests**
  - Schema (build at version 8 with `load_migrations()[:8]`, insert rows, migrate to 9):
    - `test_009_marks_only_older_unconfirmed_pay`: an import with first day 2026-03-01; pays typed 2026-02-13 (marked), 2026-02-27 but removed (not marked), 2026-03-13 (not marked), and one 2026-02-20 linked to a deposit (not marked).
    - `test_009_marks_nothing_without_imports`.
  - Store:
    - `test_hand_checked_pay_is_locked_like_confirmed` (set `hand_checked_at` directly in SQL, standing in for the migration): edit net → `IncomeError` without "statement" in the message; remove → `IncomeError`; stub edit OK; `confirmed is True`, `hand_checked is True`.
    - `test_hand_checked_pay_is_not_offered_or_linked`: not in `unconfirmed_main_job_pay`; `link_main_job_pay` → `MainJobPayTaken`.
    - Update existing assertions that match "confirmed by the statement" to the new wording.
  - View: `checked_by_hand` true for it and false otherwise (in `test_income_view.py`).
  - Frontend: `payStatus(true, true)` → `"✓ confirmed (checked by hand)"`; `payStatus(true)` and `payStatus(false)` unchanged.
- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_income_schema.py tests/test_income.py tests/test_income_view.py -q` and `cd frontend && npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.** In IncomePanel, pass `row.checked_by_hand` to `payStatus`.
- [ ] **Step 4: Run** the full backend suite and `npm test && npm run typecheck && npm run build`. Expected: all PASS.
- [ ] **Step 5: Commit** `git commit -m "Vault: older pay typed in before the first statement is marked checked by hand (one-time, migration 009)"`

### Task 2: Finish

- [ ] Runbook line under "Typing in main-job pay": older pays typed before the first imported statement were marked checked by hand once; new ones never are. `graphify update .`. Fresh full check (SPEC section 2). Commit.
