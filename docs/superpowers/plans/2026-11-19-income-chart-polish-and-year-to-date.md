# Income chart polish and year to date: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> Public file. Generic wording only.

**Goal:** Smaller coloured month amounts plus a white bracketed total for multi-source months and a "Total" legend entry; a centred goal mark; "Net this month"; a "<year> so far" tile.

**Architecture:** `monthLines` gains the total line (pure, tested); the chart and legend render it. `income_view` adds a `year` block computed in its existing loops; IncomePanel adds the tile. CSS for sizes and the goal mark.

**Tech Stack:** Python, pytest; React + TypeScript, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-19-income-chart-polish-and-year-to-date-design.md`

**Branch:** `income-chart-polish-ytd` off `main`.

## Global Constraints

- Integer cents; employer contributions never in a total; GET never writes.

## Review Focus

1. **One-source month**: no bracketed total. Test: `monthLines adds a total only for two or more sources`.
2. **Two sources where one rounds to $0**: no total line (only one line shown). Same test.
3. **Last year's income** never counts in the year tile. Test: `test_view_year_counts_only_this_calendar_year`.
4. **Pay without gross** counts its net in the year gross, as in the month. Same test.
5. **Year net** = main-job net + side − set-aside on this year's side income. Same test.

---

### Task 1: Chart, legend and labels

**Files:** `frontend/src/vault/income.ts`, `frontend/src/vault/charts.tsx`, `frontend/src/vault/vault.css`, `frontend/src/vault/IncomePanel.tsx` (net label only); test `frontend/tests/income.test.ts`.

**Interfaces:**
- `monthLines(bySource)` → `{ key: string; text: string; total?: boolean }[]`: as today, plus a final `{ key: "total", text: "($7,214)", total: true }` when two or more lines are shown. The total is the sum of all the month's sources (including any that round to $0 on their own), shown with `wholeDollars`.

- [ ] **Step 1: Write the failing test**: `monthLines adds a total only for two or more sources`. `[{main_job, 500000}, {platform_a, 221400}]` → last line `{key:"total", text:"($7,214)", total:true}`; `[{main_job, 500000}]` → one line, no total; `[{main_job, 500000}, {extra, 30}]` → one line, no total.
- [ ] **Step 2: Run** `cd frontend && npm test`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Chart:** total lines get class `in-chart__total` (white fill), source lines keep their colour.
  - **CSS:** `.in-chart__amount` 9 px; `.in-chart__total` 9 px white.
  - **Legend:** a "Total" item with a white swatch, after the sources and before Goal. Centre the goal mark with `vertical-align: middle` (and no extra height).
  - **Net tile:** the label reads "Net this month (after the tax set-aside)".
- [ ] **Step 4: Run** `npm test && npm run typecheck && npm run build`. Expected: PASS.
- [ ] **Step 5: Commit** `"Income chart: smaller amounts, month total in brackets, Total in the legend, centred goal mark; 'Net this month'"`

### Task 2: Year-to-date tile

**Files:** `src/aicity/income_view.py`, `frontend/src/api.ts`, `frontend/src/vault/IncomePanel.tsx`; test `tests/test_income_view.py`.

**Interfaces:**
- `income_view(...)["year"] = {"year": int, "gross_cents", "net_cents", "main_job_gross_cents", "side_gross_cents"}` for `today.year`.
  - `main_job_gross_cents`: the pay's gross, or its net when gross is missing.
  - `side_gross_cents`: all side income received this year (the existing `year_side`).
  - `net_cents`: main-job net + side − `set_aside_cents(side)`.

- [ ] **Step 1: Write the failing test**: `test_view_year_counts_only_this_calendar_year`.
  - Today 2026-03-25. Data:
    - main pay 2025-12-19 (gross 300000; excluded);
    - main pay 2026-01-09 (gross 300000, net 210000);
    - main pay 2026-02-06 (net 205000, no gross);
    - side 2026-02-20 50000;
    - side 2025-12-30 40000 (excluded).
  - Expect:
    - `main_job_gross_cents == 505000`;
    - `side_gross_cents == 50000`;
    - `gross_cents == 555000`;
    - `net_cents == 210000 + 205000 + 50000 - 10000` (20% set-aside);
    - `year == 2026`.
- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_income_view.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.** The tile sits between Net this month and Tax set-aside: title "<year> so far", gross large, "net $X", and "Main job $A · Side income $B".
- [ ] **Step 4: Run** `.venv/bin/pytest -q` and the frontend checks. Expected: PASS.
- [ ] **Step 5: Commit** `"Vault: year-to-date tile (gross, net, main job and side income)"`

### Task 3: Finish

- [ ] `graphify update .`; fresh full check (SPEC section 2); commit.
