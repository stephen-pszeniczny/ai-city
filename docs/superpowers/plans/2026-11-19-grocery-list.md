# Grocery List (PR 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A simple grocery list in Mission Control: add items, tick them off, clear ticked ones. Its count shows on the plan's grocery day and in the Sunday check-in.

**Architecture:** Migration 013 adds `grocery_items` (never deleted; "clear" and "remove" set a status). `grocery.py` holds `GroceryStore`, with an `add` other buildings can call later (Training Bay recipes). Routes under `/api/grocery`. A new "Grocery list" app on the Mission Control desktop shows the list as chips; the Daily plan's grocery-day marker and the check-in show the open-item count.

**Tech Stack:** Python 3.13, FastAPI, SQLite, pytest; React + TypeScript, node:test.

**Spec:** `docs/superpowers/specs/2026-11-19-week-plan-checkin-routines-grocery-design.md` (PR 4 of 4).

## Global Constraints

- Public repo: Sample items are invented; real items live only in the Personal database.
- Tables STRICT with CHECKs; rows never deleted.
- Every GET route only reads.
- **No large blocks of text (Steve):** the app is an add box plus chips and one "Clear ticked" button; no helper sentences.
- No new dependencies; format before each commit; check `git log` after each commit.
- Not in this PR: quantities, aisles, recipes or nutrition (later, Training Bay), phone access (Phase 2), reminders.

## Calls made here

- **Duplicates:** adding an item whose name matches an item already on the list (ignoring case and spaces at the ends), ticked or not, returns that item instead of adding a second one. If it was ticked, it's unticked (you need it again).
- **Remove** takes one item off the list (a typo or a change of mind); **Clear ticked** takes every ticked item off. Both set `status = 'cleared'`; nothing is deleted.
- **Order:** unticked items first (oldest first), then ticked ones (most recently ticked last).
- **The count** shown elsewhere is the number of unticked items.

## Review Focus

1. **"eggs" when "Eggs" is already listed, or " Eggs ":** no second item; a ticked "Eggs" comes back unticked. Test in Task 2.
2. **Clear ticked with nothing ticked:** returns 0 and changes nothing. Test in Task 2.
3. **Ticking or removing an item already cleared:** 409 with a clear message, not a silent change. Test in Task 3.
4. **A 101-character or blank item name:** 422 from the route, and the database refuses it too. Tests in Tasks 1 and 3.
5. **The count after ticking on the grocery day:** the Daily plan's marker and the check-in update straight away (queries invalidated). Checked in Task 6's live run plus the helper test in Task 5.

---

### Task 1: Migration 013

**Files:** Create `src/aicity/migrations/013_grocery.sql`; Test `tests/test_grocery_schema.py`

**Interfaces:**
- `grocery_items(id INTEGER PRIMARY KEY, name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100 AND name = trim(name)), status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','ticked','cleared')), created_at, ticked_at, cleared_at` (UTC stamp CHECKs)`, CHECK ((status = 'ticked') = (ticked_at IS NOT NULL)), CHECK ((status = 'cleared') = (cleared_at IS NOT NULL))) STRICT`, a never-deleted trigger, and index `grocery_items_by_status (status, id)`.
  (A cleared item keeps no `ticked_at`: clearing sets `ticked_at = NULL`.)

- [ ] **Step 1: Failing tests:** good open/ticked/cleared rows; refused: blank, untrimmed, 101 characters, unknown status, ticked without `ticked_at`, open with `ticked_at`, cleared without `cleared_at`; DELETE refused ("never deleted").
- [ ] **Step 2–4:** run (fail), write migration (header comment style of 010), run (pass) + `tests/test_db.py`.
- [ ] **Step 5: Commit** `Migration 013: grocery items`

---

### Task 2: `grocery.py`

**Files:** Create `src/aicity/grocery.py`; Test `tests/test_grocery.py`

**Interfaces:**
- `class GroceryError(ValueError)`, `class GroceryItemNotFound(LookupError)`
- `@dataclass(frozen=True) class GroceryItem: id: int; name: str; ticked: bool`
- `class GroceryStore(conn, *, clock=utc_now)`:
  - `items(self) -> list[GroceryItem]` (open then ticked, order above)
  - `open_count(self) -> int`
  - `add(self, name: str) -> GroceryItem` (trim; 1–100 else `GroceryError("An item needs a name of 1 to 100 characters.")`; duplicate rule above)
  - `set_ticked(self, item_id: int, ticked: bool) -> GroceryItem` (cleared → `GroceryError("That item was taken off the list.")`; unknown → `GroceryItemNotFound`)
  - `remove(self, item_id: int) -> None` (same refusals)
  - `clear_ticked(self) -> int` (how many were cleared)

- [ ] **Step 1: Failing tests:** add / list order; duplicates (case and spaces; a ticked duplicate comes back unticked); tick / untick; remove hides it; clear ticked returns the count and leaves unticked items; clear with none ticked → 0; refusals and their messages; `open_count`.
- [ ] **Step 2–4:** run (fail), implement (each write one immediate transaction; module docstring mentions recipes can call `add` later), run (pass).
- [ ] **Step 5: Commit** `Grocery list: add, tick, remove, clear ticked`

---

### Task 3: Routes

**Files:** Create `src/aicity/grocery_routes.py` (prefix `/api/grocery`), register in `main.py`; Modify `tests/test_get_routes_read_only.py`; Test `tests/test_grocery_routes.py`

**Interfaces:**
- `GET /api/grocery` (reads only) → `{"items": [{"id","name","ticked"}], "open": int}`
- `POST /api/grocery` body `{"name": str}` → 201 item
- `POST /api/grocery/{id}/tick` body `{"ticked": bool}` → item
- `POST /api/grocery/{id}/remove` → `{"removed": true}`
- `POST /api/grocery/clear-ticked` → `{"cleared": int}`
- Errors: not found 404, `GroceryError` 409, validation 422 (name stripped, 1–100), settings 503 (same rule as every route).

- [ ] **Step 1: Failing tests:** GET read-only with fields; add (201), duplicate returns the same id; tick/untick; remove; clear-ticked count; 404; 409 on a cleared item; 422 for blank, 101 characters, extra field; Sample mode uses the Sample database.
- [ ] **Step 2–4:** run (fail), implement, run (pass).
- [ ] **Step 5: Commit** `Grocery routes`

---

### Task 4: Sample mode

**Files:** Modify `src/aicity/sample_data.py`; Test `tests/test_sample_data.py`

- `seed_grocery(conn, now) -> bool`: once (meta `sample_grocery_seeded`), adds invented items "Oat milk", "Bananas", "Rice", "Spinach", "Coffee beans", "Lemons", and ticks "Rice". Called from `seed_sample_database`; refuses the Personal database.
- [ ] **Step 1:** failing tests (seeded once: 6 items, 5 open; refuses Personal). **Step 2–4:** fail, implement, pass. **Step 5: Commit** `Sample mode: a made-up grocery list`

---

### Task 5: Frontend data and helpers

**Files:** Modify `frontend/src/api.ts` (`GroceryItem`, `GroceryList`, `getGrocery`, `addGrocery`, `tickGrocery`, `removeGrocery`, `clearTickedGrocery`); Create `frontend/src/plan/grocery.ts`; Test `frontend/tests/grocery.test.ts`

**Interfaces:**
- `itemCountLabel(open: number): string` → `"1 item"`, `"6 items"`, `"empty"` for 0
- `tickedCount(list: GroceryList): number`

- [ ] **Step 1:** failing tests. **Step 2–4:** fail, implement, pass + typecheck. **Step 5: Commit** `Grocery list: frontend calls and helpers`

---

### Task 6: Grocery list app and counts

**Files:** Create `frontend/src/plan/GroceryPanel.tsx` (styles in `plan.css`); Modify `frontend/src/desktop/apps.ts` (Mission Control: To-do, Daily plan, Sunday check-in, **Grocery list** (`grocery`, ready), Projects), `frontend/src/desktop/Desktop.tsx` (icon "🛒", render), `frontend/src/plan/PlanPanel.tsx` (marker "🛒 Grocery day · {itemCountLabel}"), `frontend/src/plan/CheckinPanel.tsx` (grocery section shows the count next to the select), `frontend/tests/apps.test.ts`

**Behaviour (compact):**
- Top: one input ("Add item") + Add button (Enter adds; input clears; refocuses).
- Items as chips in a wrapping row: tap toggles ticked (ticked chips muted with ✓, `aria-pressed`); a small × on each chip removes it.
- Footer: "Clear ticked (n)" button, shown only when n > 0.
- Query key `["grocery"]`; every change invalidates `["grocery"]` (the Daily plan and check-in read the same key, so counts update at once). Errors inline.

- [ ] **Step 1:** update `apps.test.ts` (grocery app listed, ready) → `npm test` fails.
- [ ] **Step 2:** implement panel and wiring.
- [ ] **Step 3:** `npm --prefix frontend test`, typecheck, build pass.
- [ ] **Step 4: Real run** on a throwaway Sample server (8799, `Host`/`Origin` headers): GET, add, add a duplicate in different case (same id), tick, clear ticked, remove, tick a cleared item (409).
- [ ] **Step 5: Commit** `Mission Control: grocery list app`

---

### Task 7: Docs and wrap-up

- [ ] Runbook: "Grocery list" (what it does, duplicates, remove vs clear ticked, the count on the grocery day; phone access comes in Phase 2).
- [ ] Design doc: record the calls above.
- [ ] Full fresh check (caches cleared with `find … -delete`): pytest, hook tests, ruff check + format (`src tests scripts`), frontend test/typecheck/build, gitleaks full history, blocked words over every tracked file; `graphify update .`
- [ ] Commit `Runbook: grocery list`
