# Sunday Check-in (PR 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Sunday check-in in Mission Control: it plans the coming week (usual-event chips, other events, grocery day, to-dos needing attention), with one weekly reminder and a "Check-in due" badge.

**Architecture:** `[plan]` settings gain check-in times and `[[plan.usual_events]]`. A pure function in `plan.py` decides which week the check-in is for and whether it's due. `PlanStore` gains grocery day and finish. A new `checkin_reminder.py` makes the weekly notification from the background check (Personal only), with migration 011 adding the `checkin` notification kind. New routes under `/api/plan/checkin`; a `CheckinPanel` app on the desktop; the planner badge adds "Check-in due".

**Tech Stack:** Python 3.13, FastAPI, SQLite, pytest; React + TypeScript, node:test.

**Spec:** `docs/superpowers/specs/2026-11-19-week-plan-checkin-routines-grocery-design.md` (PR 2 of 4).

## Global Constraints

- Public repo: example values only; real events and times live in the private settings.
- Settings strict: unknown keys refused, messages never repeat values. New keys optional, so existing private settings keep loading.
- Every GET route only reads. Opening the check-in (which may create the week) is a POST.
- Check-in and reminders: Personal mode only for the reminder; Sample mode gets one pre-made check-in notification at seed.
- "Today" and "now" are local Mac time (`clock().astimezone()`), as elsewhere.
- No new dependencies. Run `ruff format src tests` before every commit (shell edits skip the format hook) and check `git log` after each commit.
- Not in this PR: routines, the grocery list itself (only the grocery day), habits.

## Rulings carried in from the design (designer's calls, recorded here)

- **The check-in day is Sunday, fixed.** Only `checkin_opens` (default `"12:00"`) and `checkin_reminder` (default `"16:00"`) are settings. Steve chose Sunday; a movable day would complicate the "which week" rule for no use.
- **Which week:** Sunday from `checkin_opens` → next week (Monday after). Any other moment → this week if it isn't checked in, otherwise next week.
- **Due** (badge): the target week isn't checked in AND (it's Sunday from `checkin_opens`, OR the target is this week). In words: from Sunday noon until next week is checked in, and all week while this week isn't.
- **Reminder:** one per target week, made when `now >=` (the Sunday before the target Monday, at `checkin_reminder`) and the target isn't checked in. A Mac asleep at 16:00 gets it at the next check. Cleared when that week is checked in. Title: `"Time for your Sunday check-in"`.
- **Ticker:** the check-in notification isn't clickable (like the statement reminder).

## Review Focus

1. **Sunday 11:59 vs 12:00, and Sunday after next week is already checked in**: target and due flip exactly at `checkin_opens`; with next week done, nothing is due and no reminder is made. Tests in Task 2.
2. **Mac asleep all Sunday**: on Monday the target is this week, it's due, and exactly one reminder is made (not one per check). Test in Task 4.
3. **Finishing the check-in twice, or reopening it**: `checked_in_at` keeps the first time; events added the first time show (no duplicates come from reopening). Tests in Tasks 3 and 5.
4. **A usual event whose default day is in the past for the target week** (e.g. Monday, check-in done Wednesday): the chip says it can't be added to a past day, rather than a raw error. Test in Task 7 (helper), server already refuses past days.
5. **Grocery day outside the target week or on a past day**: refused with a clear 409; clearing it (null) works. Tests in Tasks 3 and 5.

---

### Task 1: Check-in settings and usual events

**Files:**
- Modify: `src/aicity/settings.py`, `settings.example.toml`
- Test: `tests/test_settings.py`

**Interfaces:**
- Produces:
  - `USUAL_EVENT_KINDS = ("event", "side_work", "build", "other")`
  - `@dataclass(frozen=True) class UsualEvent: title: str; kind: str; day: int | None; start: time; end: time`
  - `PlanSettings` gains `checkin_opens: time = time(12)`, `checkin_reminder: time = time(16)`, `usual_events: tuple[UsualEvent, ...] = ()`
- `[plan]` keys allowed: `blocks` (required, as now), `checkin_opens`, `checkin_reminder`, `usual_events` (optional). Usual event keys: `title`, `start`, `end` required; `kind` (default `"event"`), `day` (one day code) optional. Same title/time rules as blocks.

- [ ] **Step 1: Failing tests** in `tests/test_settings.py`: `test_checkin_times_default` (no keys → 12:00, 16:00, no usual events); `test_checkin_times_read`; `test_usual_events_parse` (one with day `"thu"` → `day=3`, one without day and kind → `day=None, kind="event"`); `test_usual_event_refuses` (parametrised, fragment in message, value never echoed): unknown key, kind `"gym"`, day `"thursday"`, day as a list, end ≤ start, missing title, `usual_events` not a list; `test_checkin_time_refuses` (`"4pm"` for `checkin_reminder`).
- [ ] **Step 2: Run, expect failures:** `.venv/bin/pytest tests/test_settings.py -q`
- [ ] **Step 3: Implement** `_usual_event(t, n) -> UsualEvent`, extend `_plan` (use `_only_keys` + required `blocks`), reuse `_clock_time`.
- [ ] **Step 4: Example:** add commented `checkin_opens`, `checkin_reminder` and two `[[plan.usual_events]]` ("Team sport" thu 21:00–22:00; "Games night" without day 19:00–21:00) under the `[plan]` example.
- [ ] **Step 5: Run, expect pass; full suite.** `.venv/bin/pytest -q`
- [ ] **Step 6: Commit** `Settings: check-in times and usual events`

---

### Task 2: Which week, and is it due

**Files:**
- Modify: `src/aicity/plan.py`
- Test: `tests/test_plan.py`

**Interfaces:**
- Produces in `aicity.plan`:
  - `@dataclass(frozen=True) class CheckinStatus: week_start: date; due: bool; checked_in: bool; reminder_at: datetime` (`reminder_at` naive local: the Sunday before `week_start` at `checkin_reminder`)
  - `def checkin_target(now_local: datetime, opens: time, this_week_checked_in: bool) -> date`
  - `PlanStore.checkin_status(self, now_local: datetime, rules: PlanSettings) -> CheckinStatus` (reads only; an unsaved week counts as not checked in)

- [ ] **Step 1: Failing tests** (pure `checkin_target`, then `checkin_status` with a store):
  - Sunday 2026-11-29 11:59 → target 2026-11-23 if not checked in; 12:00 → 2026-11-30.
  - Wednesday 2026-11-25, this week not checked in → 2026-11-23; checked in → 2026-11-30.
  - `checkin_status` Sunday 12:00, next week not saved → due, `reminder_at == datetime(2026, 11, 29, 16, 0)`.
  - Sunday 12:00 with next week checked in → not due.
  - Wednesday with this week checked in → target next week, not due.
  - Wednesday, this week not checked in → due, `reminder_at == datetime(2026, 11, 22, 16, 0)`.
- [ ] **Step 2: Run, expect failures:** `.venv/bin/pytest tests/test_plan.py -q`
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect pass.**
- [ ] **Step 5: Commit** `Plan: which week the check-in is for, and when it's due`

---

### Task 3: Grocery day and finishing the check-in

**Files:**
- Modify: `src/aicity/plan.py` (`Week` gains `grocery_day: str | None`)
- Test: `tests/test_plan.py`

**Interfaces:**
- Produces on `PlanStore`:
  - `set_grocery_day(self, week_start: date, day: date | None, today: date) -> Week`: day must be in the week and not before today → else `PlanError("The grocery day must be a day of that week, today or later.")`; None clears; week must be saved.
  - `finish_checkin(self, week_start: date) -> Week`: sets `checked_in_at` only if null (first finish kept); week must be saved.

- [ ] **Step 1: Failing tests:** `test_grocery_day_set_and_cleared`; `test_grocery_day_refuses_past_or_outside` (two cases, message match); `test_finish_checkin_keeps_the_first_time` (finish, advance clock, finish again → same stored stamp; `checked_in` true); `test_finish_unsaved_week_is_refused`.
- [ ] **Step 2: Run, expect failures.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect pass** (`tests/test_plan.py tests/test_plan_schema.py`).
- [ ] **Step 5: Commit** `Plan: grocery day and finishing the check-in`

---

### Task 4: Weekly reminder (migration 011 + background check)

**Files:**
- Create: `src/aicity/migrations/011_checkin_notifications.sql`, `src/aicity/checkin_reminder.py`
- Modify: `src/aicity/reminder_loop.py` (Personal: also `_checkin(...)`), `src/aicity/notifications.py` docstring (kinds list), `frontend/src/api.ts` (`kind: "reminder" | "statement" | "checkin"`)
- Test: `tests/test_checkin_reminder.py`, `tests/test_reminder_loop.py` (one case)

**Interfaces:**
- Migration 011: rebuild `notifications` as 007 did, with `kind IN ('reminder','statement','checkin')`, `CHECK (kind <> 'checkin' OR task_id IS NULL)`, the existing indexes, plus `CREATE UNIQUE INDEX notifications_one_checkin_a_week ON notifications (due_at) WHERE kind = 'checkin'`.
- `CHECKIN_TITLE = "Time for your Sunday check-in"`
- `def check_checkin_reminder(conn, now_local: datetime, rules: PlanSettings, clock_utc: datetime) -> int`: in one immediate transaction: if `checkin_status` says the target is checked in → clear (set `cleared_at`) any uncleared, undismissed checkin rows, return 0; if not checked in and `now_local >= reminder_at` → `INSERT OR IGNORE` with `due_at = reminder_at` as `YYYY-MM-DDTHH:MM`; return rows made.
- `reminder_loop._checkin(conn, clock, local_tz, load) -> int`: settings without `[plan]` → 0; settings error → logged by type, 0.

- [ ] **Step 1: Failing tests** in `tests/test_checkin_reminder.py` (temp Personal db, `PlanSettings` built in the test): Sunday 15:59 → 0; 16:00 → 1; again at 16:30 → 0 (once); Monday 08:00 after a Sunday the Mac slept through (no row yet), this week unsaved → 1 with `due_at` of the previous Sunday 16:00; after `finish_checkin` of that week → the row gets `cleared_at`, and the next check makes none; a dismissed row stays dismissed and isn't remade. Schema: `test_checkin_kind_never_has_a_task` (IntegrityError). Loop: `test_loop_makes_checkin_reminder_in_personal_only` using a settings file with `[plan]`.
- [ ] **Step 2: Run, expect failures:** `.venv/bin/pytest tests/test_checkin_reminder.py tests/test_reminder_loop.py -q`
- [ ] **Step 3: Implement** migration, module, loop hook (mirrors `_statement`).
- [ ] **Step 4: Run, expect pass; full suite** (notification and statement tests must still pass after the rebuild).
- [ ] **Step 5: Commit** `Check-in reminder: once a week from Sunday afternoon`

---

### Task 5: Check-in routes

**Files:**
- Modify: `src/aicity/plan_routes.py` (week JSON adds `grocery_day`), `tests/test_get_routes_read_only.py` (`/api/plan/checkin`)
- Test: `tests/test_plan_routes.py`

**Interfaces:**
- `GET /api/plan/checkin` (reads only) → `{"configured", "week_start", "due", "checked_in", "opens": "12:00", "usual_events": [{"title","kind","day": "2026-11-26"|null,"start","end"}]}`; `day` is the usual event's weekday turned into a date in the target week.
- `POST /api/plan/checkin/open` → the target week's JSON (week created if needed) plus `"usual_events"` as above.
- `POST /api/plan/week/{start}/grocery-day` body `{"day": "YYYY-MM-DD" | null}` → week JSON.
- `POST /api/plan/week/{start}/checkin` → week JSON (finished) and clears the reminder (call `check_checkin_reminder` right after, Personal only).
- `configured:false` (no `[plan]`) → GET returns `configured:false, due:false`; POSTs create nothing.

- [ ] **Step 1: Failing tests:** GET read-only and its fields on a Sunday 13:00 fake clock (target next week, due); open creates next week; grocery day set/clear/409 (past, outside); finish twice keeps first time and a checkin notification row gets cleared; no-plan settings → configured false; Sample mode works with `SAMPLE_PLAN`.
- [ ] **Step 2: Run, expect failures.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect pass** (`tests/test_plan_routes.py tests/test_get_routes_read_only.py`).
- [ ] **Step 5: Commit** `Check-in routes: status, open, grocery day, finish`

---

### Task 6: Sample mode

**Files:**
- Modify: `src/aicity/sample_data.py`
- Test: `tests/test_sample_data.py`

**Interfaces:**
- `SAMPLE_PLAN` gains two invented usual events ("Book club" no day 19:00–20:30; "Five-a-side" fri 20:00–21:00) and keeps default check-in times.
- `seed_plan` also inserts one `checkin` notification (title `CHECKIN_TITLE`, `due_at` = 10 minutes before now, local minute), once.

- [ ] **Step 1: Failing test:** `test_sample_has_one_checkin_notification` (exactly one active `checkin` row after seeding twice).
- [ ] **Step 2–4:** run (fail), implement, run (pass; also `tests/test_sample_data.py tests/test_notifications.py`).
- [ ] **Step 5: Commit** `Sample mode: check-in chips and a check-in notification`

---

### Task 7: Frontend data and helpers

**Files:**
- Modify: `frontend/src/api.ts` (types `UsualEvent`, `CheckinStatus`; `PlanWeek.grocery_day`; calls `getCheckin`, `openCheckin`, `setGroceryDay`, `finishCheckin`), `frontend/src/belt/badges.ts`
- Create: `frontend/src/plan/checkin.ts`
- Test: `frontend/tests/checkin.test.ts`, `frontend/tests/badges.test.ts`

**Interfaces:**
- `checkin.ts`:
  - `chipState(event: UsualEvent, week: PlanWeek): "add" | "added" | "past" | "pick-day"`: `"added"` if an added block with the same title, day and start exists; `"past"` if its day is before `week.today`; `"pick-day"` if `day` is null; else `"add"`.
  - `needsAttention(tasks: Task[], weekStart: string, today: string): { overdue: Task[]; dueThisWeek: Task[]; stale: Task[] }`: open tasks only; overdue = goal before today; due = goal within the week and not overdue; stale = `stale` and not already in the other two.
  - `addedEvents(week: PlanWeek): PlanBlock[]`: added blocks across the week, by day then start.
- `badges.ts`: `plannerBadge(tasks, now?, checkinDue = false)`: order "N overdue", then "Check-in due", then "N stale".

- [ ] **Step 1: Failing tests** for each helper (including `chipState` past case and the badge order).
- [ ] **Step 2–4:** `cd frontend && npm test` (fail), implement, `npm test && npm run typecheck` (pass).
- [ ] **Step 5: Commit** `Check-in: frontend calls, helpers and badge`

---

### Task 8: Check-in app, plan and belt wiring

**Files:**
- Create: `frontend/src/plan/CheckinPanel.tsx` (styles in `plan.css`)
- Modify: `frontend/src/desktop/apps.ts` (`checkin` ready), `frontend/src/desktop/Desktop.tsx` (render it), `frontend/src/plan/PlanPanel.tsx` (grocery day marker "🛒 Grocery day" on that day; "Not checked in yet: open Sunday check-in from the dock." note when `!checked_in`), `frontend/src/belt/Labels.tsx` (query `["plan-checkin"]` → `getCheckin`, pass `due` to `plannerBadge`), `frontend/tests/apps.test.ts`

**Behaviour** (one screen, top to bottom, as the design):
1. Heading "Plan the week of {dayLabel(week_start)}" + "Already checked in" tag when so.
2. Fixed blocks at a glance: each day's settings blocks in one compact line per day.
3. Add events: chips per `chipState` ("add" → one tap adds on its day/times; "pick-day" → tap shows a day select of non-past days, then adds; "added" → shown ticked, not clickable; "past" → disabled with title "That day has passed"). "Add other event" reuses the `BlockForm` pattern with a day select (non-past days) and kinds event/side_work/build/other. Below: the week's added events with Remove.
4. Grocery day: select of non-past days plus "None this week" → `setGroceryDay`.
5. To-dos needing attention: three short lists from `needsAttention` (title + goal date); "Open the To-do app from the dock to change them."
6. Finish button → `finishCheckin`; on success invalidate `["plan"]`, `["plan-checkin"]`, `["notifications"]`, show "Week saved."
- Mutations invalidate `["plan"]` and `["plan-checkin"]`. Errors inline (`form-error`).
- The query uses `openCheckin` (POST, idempotent) with a comment saying why.

- [ ] **Step 1:** update `apps.test.ts` (checkin ready) → `npm test` fails.
- [ ] **Step 2:** implement panel and wiring.
- [ ] **Step 3:** `cd frontend && npm test && npm run typecheck && npm run build` pass.
- [ ] **Step 4: Real run:** throwaway Sample server on 8799 (temp `AICITY_DATA_DIR`, `Host: 127.0.0.1:8765` + Origin headers): GET check-in, open, add a chip event, set grocery day, finish twice; confirm JSON. Screens: Steve checks after the update.
- [ ] **Step 5: Commit** `Mission Control: Sunday check-in app`

---

### Task 9: Docs and wrap-up

- [ ] Runbook (section 6): "Sunday check-in" (what it does, the reminder at `checkin_reminder`, the badge rule, usual events in settings, reopening is safe) and the new settings keys.
- [ ] Design doc: record the fixed-Sunday ruling and the due/reminder wording above.
- [ ] Full fresh check (caches cleared): pytest, hook tests, ruff check + format (`src tests scripts`), frontend test/typecheck/build, gitleaks full history, blocked words over every tracked file. `graphify update .`
- [ ] Commit `Runbook: Sunday check-in`
