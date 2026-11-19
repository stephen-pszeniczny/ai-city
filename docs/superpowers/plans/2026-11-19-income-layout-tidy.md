# Income app layout tidy: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> Public file. Generic wording only.

**Goal:** Income opens first; the split goal is gone; tile 1 shows main job and side income amounts; four short titles with the large amounts lined up.

**Architecture:** reorder the Vault app list; revert the split-goal code paths (settings, view, route, Sample); add `main_job_label` to the month JSON from the route; restyle the four tiles.

**Tech Stack:** Python, pytest; React + TypeScript, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-19-income-layout-tidy-design.md`

**Branch:** `income-layout-tidy` off `main`.

## Global Constraints

- No real names in tracked files; Sample never reads private settings.
- Steve's private settings must be back to `monthly_income` **before** this ships (the split keys will be refused after it).

## Review Focus

1. **Settings file with the old split keys** after this change: refused with a clear message, not a crash (the owner's file is changed first). Test: `test_old_goal_split_keys_are_refused`.
2. **Sample label is "Main job", Personal is the settings' main-job name.** Tests: `test_month_main_job_label_*`.
3. **Income is the first and open app on the Vault computer.** Test in `apps.test.ts`.
4. **Placeholder chip still shown** when the set-aside is a placeholder. Covered by keeping the existing chip render (manual check of the diff).
5. **Large amounts aligned:** titles one line each; no tile has extra heading lines (diff check).

---

### Task 1: App order, split goal removed, main-job label

**Files:** `frontend/src/desktop/apps.ts`; `src/aicity/settings.py`, `src/aicity/income_view.py`, `src/aicity/vault_routes.py`, `src/aicity/sample_data.py`, `settings.example.toml`, `docs/RUNBOOK.md`. Tests: `frontend/tests/apps.test.ts`, `tests/test_settings.py`, `tests/test_income_view.py`, `tests/test_vault_routes.py`.

- [ ] **Step 1: Write the failing tests**
  - `apps.test.ts`: the Vault's app ids are `["income", "sidework", "statements"]`.
  - `test_old_goal_split_keys_are_refused`: `main_job_monthly` in `[goals]` gives a `SettingsError` naming it.
  - `test_month_main_job_label_personal`: the route gives `month.main_job_label == "Day job"` (the test settings' main-job name).
  - `test_month_main_job_label_sample`: Sample gives `"Main job"`.
  - Remove the split-goal tests (settings, view, Sample route). Note: `test_view_goal_split_amounts` becomes `test_view_month_source_amounts` (the same amounts, without `goal_split`).
- [ ] **Step 2: Run** them and check they fail.
- [ ] **Step 3: Implement.**
  - `Goals` goes back to `monthly_income_cents`, `currency` (exact keys).
  - `income_view` drops `goal_split` and gains `main_job_label: str = "Main job"` (keyword), which goes into the month JSON.
  - The route passes `"Main job"` in Sample, else `main_job.name` (or `"Main job"`).
  - Remove `SAMPLE_GOAL_SPLIT`, the example lines, and the runbook split text.
  - Apps reordered.
- [ ] **Step 4: Run** the full backend and frontend checks. Commit `"Vault: Income opens first; split goal removed; month carries the main-job label"`.

### Task 2: The four tiles

**Files:** `frontend/src/api.ts`, `frontend/src/vault/IncomePanel.tsx`, `frontend/src/vault/vault.css`.

- [ ] **Titles:** "Monthly Gross", "Monthly Net", "Annual Gross", "Tax Set Aside", one line each.
- [ ] **Tile 1:** the goal bar and label as before; then two rows, `main_job_label` and "Side income", with the amounts right-justified. No split bars.
- [ ] **Tile 2:** the employer contributions line under the amount.
- [ ] **Tile 3:** "net $X", then "Main job $A" (`main_job_label`), then on its own line "Side income $B".
- [ ] **Tile 4:** the placeholder chip under the amount.
- [ ] **Run** `npm test && npm run typecheck && npm run build`. Commit `"Income tiles: short titles, amounts aligned, tidier lines"`.

### Task 3: Finish

- [ ] `graphify update .`; fresh full check; commit.
