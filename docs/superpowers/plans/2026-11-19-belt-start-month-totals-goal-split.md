# Start at the belt, month totals, split goal: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> Public file. Generic names only; real amounts live in the private settings.

**Goal:** Fresh opens start at the belt; each month's bar lists its sources' totals in their colours; the income goal splits into main job and side income with two progress bars.

**Architecture:** Pure helpers (tested with `node --test`) for the start address and month lines; the chart renders the lines in its SVG. The goal split is two optional settings parsed in `settings.py`, passed through `income_view` as month fields, and drawn as two meters in the "This month" card.

**Tech Stack:** Python 3 + FastAPI, pytest; React + TypeScript, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-19-belt-start-month-totals-goal-split-design.md`

**Branch:** `belt-start-goal-split` off `main`.

## Global Constraints

- Integer cents; GET routes never write; Sample never reads the private settings.
- No real names or amounts in tracked files; Sample uses invented amounts.
- Employer contributions never count toward any goal.
- A settings file without the new keys keeps working exactly as today.

## Review Focus

1. **Steve's current settings file (only `monthly_income`)** loads, total goal unchanged, no split shown. Test: `test_goal_without_split_is_as_before` (Task 2).
2. **All three goal keys set with a mismatched total** is refused with a message naming the keys. Test: `test_goal_split_must_match_monthly_income` (Task 2).
3. **A month with only one source, or none**: one line, or none, under that bar; no "$0" lines. Test: `monthLines drops empty sources` (Task 1).
4. **Opening `/todo` directly** still shows the to-do page (not redirected). Test: `startPath keeps other pages` (Task 1).
5. **Side income over its goal** (e.g. $1,400 of $1,000): bar full, label shows the real percent. Covered by reusing `goalProgress` (already tested for over-goal); assert in `test_view_goal_split_amounts` that amounts aren't capped (Task 2).

---

### Task 1: Start at the belt; month totals under the bars

**Files:**
- Modify: `frontend/src/belt/levels.ts` (add `startPath`)
- Modify: `frontend/src/main.tsx` (apply it once, before the router is created)
- Modify: `frontend/src/vault/income.ts` (add `wholeDollars`, `monthLines`)
- Modify: `frontend/src/vault/charts.tsx` (render the lines; taller SVG)
- Test: `frontend/tests/levels.test.ts`, `frontend/tests/income.test.ts`

**Interfaces:**
- Produces: `startPath(path: string): string` → `"/"` for any path that `parsePath` reads as a building or screen (`/b/...`), else the path unchanged.
- Produces: `wholeDollars(cents: number): string` → `"$5,000"` (rounded to the nearest dollar, thousands separators).
- Produces: `monthLines(bySource: readonly { key: string; cents: number }[]): { key: string; text: string }[]` → same order as given (the stack's bottom-first order), sources with `cents <= 0` dropped.

- [ ] **Step 1: Write the failing tests**
  - `startPath sends building and screen addresses to the belt`: `/b/vault` → `/`, `/b/vault/screen` → `/`.
  - `startPath keeps other pages`: `/` → `/`, `/todo` → `/todo`.
  - `wholeDollars rounds to whole dollars`: `500000` → `"$5,000"`, `123450` → `"$1,235"`, `49` → `"$0"`.
  - `monthLines drops empty sources`: `[{main_job, 500000}, {platform_a, 0}, {extra, 7550}]` → `[{key:"main_job", text:"$5,000"}, {key:"extra", text:"$76"}]`; `[]` → `[]`.
- [ ] **Step 2: Run** `cd frontend && npm test`. Expected: FAIL (missing exports).
- [ ] **Step 3: Implement.** In `main.tsx`, before `createRoot`: `const start = startPath(location.pathname); if (start !== location.pathname) history.replaceState(null, "", start);` (with a one-line comment: the Dock app reopens the last address; every fresh open starts at the belt). In `StackedMonths`, raise `H` so up to 4 lines fit under each month label (12 px per line, 10 px text), and draw `monthLines(m.by_source)` as `<text>` lines centred under the label, `fill={colourFor(key, keys)}`.
- [ ] **Step 4: Run** `cd frontend && npm test && npm run typecheck && npm run build`. Expected: all PASS.
- [ ] **Step 5: Commit** `git commit -m "Belt: fresh opens start at the belt; Income chart lists each month's totals"`

---

### Task 2: Split income goal

**Files:**
- Modify: `src/aicity/settings.py` (`Goals`, `_goals`)
- Modify: `src/aicity/income_view.py` (month fields)
- Modify: `src/aicity/vault_routes.py` (`_goal_cents` → `_goals_for` returning the goal split)
- Modify: `src/aicity/sample_data.py` (invented split summing to `SAMPLE_GOAL_CENTS`)
- Modify: `settings.example.toml` (commented example of the two keys)
- Modify: `frontend/src/api.ts`, `frontend/src/vault/IncomePanel.tsx` (two meters)
- Test: `tests/test_settings.py`, `tests/test_income_view.py`, `tests/test_vault_routes.py`

**Interfaces:**
- Produces: `Goals(monthly_income_cents: int, currency: str, main_job_cents: int | None = None, side_income_cents: int | None = None)`. Both split fields set → `monthly_income_cents` = their sum. Exactly one set → `SettingsError("Set both goals.main_job_monthly and goals.side_income_monthly, or neither.")`. `monthly_income` given too and ≠ the sum → `SettingsError("goals.monthly_income must equal goals.main_job_monthly + goals.side_income_monthly (or leave it out).")`. Neither split key and no `monthly_income` → the existing missing-key error.
- Produces: `income_view(..., goal_cents: int, ..., goal_split: tuple[int, int] | None = None)` (keyword, last). `month` gains `"main_job_gross_cents"` (the main-job gross this month, net where gross isn't typed, as the total does), `"side_gross_cents"` (all side income this month), and `"goal_split": {"main_job_cents", "side_income_cents"} | None`.
- Sample: `SAMPLE_GOAL_SPLIT = (550000, 100000)` with `SAMPLE_GOAL_CENTS = 650000` unchanged.

- [ ] **Step 1: Write the failing tests**
  - `test_goal_without_split_is_as_before` (Review Focus 1): example data → `main_job_cents is None`, total unchanged.
  - `test_goal_split_sets_the_total`: remove `monthly_income`, set `main_job_monthly = "6500.00"`, `side_income_monthly = "1000.00"` → total `750000`, split `(650000, 100000)`. (These are the values in the spec's request; they're not private.)
  - `test_goal_split_needs_both` and `test_goal_split_must_match_monthly_income` (Review Focus 2).
  - `test_view_goal_split_amounts` (Review Focus 5): main pay gross 300000 and side 140000 this month, split `(250000, 100000)` → `main_job_gross_cents == 300000`, `side_gross_cents == 140000`, `goal_split == {...}`.
  - `test_view_has_no_split_without_goals`: `goal_split is None`.
  - Route: in Sample mode, GET `/api/vault/income` → `month.goal_split == {"main_job_cents": 550000, "side_income_cents": 100000}`.
- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_settings.py tests/test_income_view.py tests/test_vault_routes.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement the backend.** Then the card: under the total meter, when `goal_split` is set, two rows "Main job" and "Side income", each a meter using `goalProgress(amount, goal)` and the label `"$X / $Y"` with `formatCad`.
- [ ] **Step 4: Run** `.venv/bin/pytest -q` and `cd frontend && npm test && npm run typecheck && npm run build`. Expected: all PASS.
- [ ] **Step 5: Live check** on a throwaway server (temp data folder, Sample mode, port 8799, API only): `month.goal_split` and the two amounts are present.
- [ ] **Step 6: Set Steve's private goals.** Only after merge and with Steve's go-ahead: in `~/AI-City-Data/settings/settings.toml`, replace the `monthly_income` line with `main_job_monthly = "6500.00"` and `side_income_monthly = "1000.00"` (edit those lines only; don't read the rest of the file).
- [ ] **Step 7: Commit** `git commit -m "Vault: split income goal (main job + side income) with two progress bars"`

### Task 3: Finish

- [ ] Runbook: how to set the two goal keys. `graphify update .`. Fresh full check (SPEC section 2): clear caches; pytest, hook tests, ruff check + format, frontend test/typecheck/build, gitleaks full history, blocked words over tracked files. Commit `"Docs: goal split"`.
