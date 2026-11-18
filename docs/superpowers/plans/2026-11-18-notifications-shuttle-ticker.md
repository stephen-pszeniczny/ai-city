# Notifications: Shuttle and Ticker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a task's reminder comes due, a small rocket flies across the belt trailing a holographic banner with the task's title, and the reminder stays in a bottom ticker until it's dismissed or the task is finished.

**Architecture:** A new `notifications` table per database. A background thread in the app turns due reminders into notifications every 30 s (both databases). Read-only `GET /api/notifications` plus mode-checked `seen` and `dismiss` POSTs. On the page, pure rules plan the shuttle queue and the ticker. A 3D rocket in the R3F scene carries an HTML banner pinned to it each frame (like building labels). A small "journey" helper chains the normal flights to open a task from the ticker.

**Tech Stack:** Python 3 + FastAPI + SQLite + pytest; React + TypeScript + Three.js / React Three Fiber + @tanstack/react-query; `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-18-notifications-shuttle-ticker-design.md` (and SPEC.md section 7, "Notifications").

## Global Constraints

- No data leaves the Mac. Notifications hold the task title only, never notes.
- Reminder times are local Mac time to the minute, `YYYY-MM-DDTHH:MM` (`reminder_at`). "Due" means `reminder_at <= now` in Mac local time, compared as strings in that format. Stored instants (`created_at`, `seen_at`, `dismissed_at`, `cleared_at`) are UTC `YYYY-MM-DDTHH:MM:SSZ`, like tasks.
- Every GET route only reads (`tests/test_get_routes_read_only.py` finds new GETs by itself).
- Database changes only through a new numbered migration (`src/aicity/migrations/003_notifications.sql`). The database's own checks refuse bad data.
- Sample mode never shows anything from Personal; seen and dismiss requests carry the mode and are refused (409) when it isn't the current one.
- Every "how much" value goes in `frontend/src/belt/look.ts`. Reduced motion: no flight, no ticker auto-advance.
- Banner text at least 17 px; titles cut with "…" at 48 characters.
- No new dependencies. Tests use made-up tasks only. Run `graphify update .` after code changes.

## Review Focus

1. **The Mac was asleep or off when reminders came due:** they all appear on the next check, and only the first 3 fly separately. Pinned in Task 1 (several due at once) and Task 5 (`planShuttles` with 5 unseen).
2. **A mode switch while a request or shuttle is in flight:** a late `dismiss` for Personal id 5 must never touch Sample id 5, and no Personal title stays on screen. Pinned in Task 3 (wrong-mode 409) and Task 5 (`queueAfterModeChange` empties).
3. **A reminder edited, removed, or the task finished, reopened, archived after it fired:** no duplicates, no stale ticker items. Pinned in Task 1.
4. **The settings file is missing, or a database file doesn't exist yet:** the background check skips quietly and the app keeps running; the GET answers 503 like other routes. Pinned in Task 2 and Task 3.
5. **A very long title or one with odd characters:** the banner stays one readable line; the text is shown as text (never as HTML). Pinned in Task 5 (`shortTitle`) and by React's normal text rendering in Task 6.

---

### Task 1: Notifications table and the reminder check

**Files:**
- Create: `src/aicity/migrations/003_notifications.sql`
- Create: `src/aicity/notifications.py`
- Test: `tests/test_notifications.py`

**Interfaces:**
- Produces in `notifications.py`:
  - `@dataclass(frozen=True) class Notification: id: int; kind: str; task_id: int | None; title: str; due_at: str; seen: bool`
  - `class NotificationNotFound(LookupError)`, `class NotificationConflict(ValueError)`
  - `SINCE_KEY = "notifications_since"`, `KEEP_DAYS = 90`
  - `class NotificationStore: __init__(self, conn: sqlite3.Connection, clock: Callable[[], datetime], local_tz: tzinfo | None = None)` (`local_tz=None` means the Mac's own zone)
  - `check_reminders(self) -> int` (number created), `list_active(self) -> list[Notification]` (oldest `due_at` first, then id), `mark_seen(self, nid: int) -> None` (idempotent), `dismiss(self, nid: int) -> None` (`NotificationConflict` if already dismissed or cleared), `NotificationNotFound` for unknown ids.
- Migration 003: table `notifications` (`id INTEGER PRIMARY KEY`, `kind TEXT NOT NULL CHECK (kind IN ('reminder'))`, `task_id INTEGER REFERENCES tasks (id)`, `title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200)`, `due_at` with the same CHECK as `reminder_at`, `created_at` NOT NULL and `seen_at`/`dismissed_at`/`cleared_at` nullable with the same CHECK as `created_at` in 002, `UNIQUE (kind, task_id, due_at)`, `CHECK (kind <> 'reminder' OR task_id IS NOT NULL)`) and an index on `(dismissed_at, cleared_at, due_at)`. Header comment in the style of 002.

- [ ] **Step 1: Write the failing tests** in `tests/test_notifications.py`. Fixture: a fresh Sample database via `open_database(tmp_path / "sample.db", DbKind.SAMPLE)` (as `tests/test_tasks.py` does), a `TaskStore` with a movable clock, local zone `ZoneInfo("Europe/London")`, and a helper that creates a task with a given `reminder_at`. Each test first runs `check_reminders()` once at a "start" time to set the start date, unless it's testing that.

```python
def test_first_check_records_the_start_date_and_skips_older_reminders():
    # task with reminder 2026-11-10T09:00; first check at 2026-11-18 12:00 local → 0 created;
    # meta notifications_since == "2026-11-18T12:00"; a later check still creates nothing for it
def test_reminder_due_after_start_creates_one_notification():   # reminder 12:30, check at 12:31 → 1, title copied
def test_exactly_due_counts():                                    # reminder 12:30, check at 12:30:00 → 1
def test_not_yet_due_creates_nothing():                           # check at 12:29
def test_checking_twice_never_duplicates():                       # two checks → still 1 row
def test_several_due_at_once_all_appear():                        # 5 reminders passed while "asleep" → 5, oldest first
def test_past_reminder_saved_after_start_fires_straight_away():   # start 12:00; at 13:00 save reminder 12:45 → fires
def test_finishing_or_archiving_the_task_clears_it():             # complete → list_active empty; same for archive
def test_editing_the_reminder_clears_the_old_and_fires_the_new_when_due():
def test_removing_the_reminder_clears_it():
def test_reopened_task_with_same_past_reminder_does_not_fire_again():
def test_seen_is_idempotent_and_shows_in_the_list():
def test_dismiss_hides_it_and_twice_is_a_conflict():
def test_unknown_id_is_not_found():
def test_cleared_or_dismissed_older_than_90_days_are_deleted():   # dismissed 91 days ago → row gone; 89 → kept
def test_notes_are_never_copied():                                # task with notes; columns of the row contain no notes text
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest tests/test_notifications.py -q`. Expected: FAIL (no module `aicity.notifications`).
- [ ] **Step 3: Implement** the migration and `notifications.py`. `check_reminders` runs in one `with_transaction(conn, work, immediate=True)`: read or set `notifications_since` in `meta`; insert for due open tasks with `reminder_at >= since` and no existing row for `(kind, task_id, reminder_at)` (`INSERT OR IGNORE`); set `cleared_at` on active reminder rows whose task is not open or whose `reminder_at` is no longer that row's `due_at`; delete dismissed or cleared rows older than `KEEP_DAYS`. Local now = `clock().astimezone(local_tz)` formatted `%Y-%m-%dT%H:%M`.
- [ ] **Step 4: Run** the same command, then the full suite `.venv/bin/python -m pytest -q`. Expected: all pass (including `tests/test_db.py` with the new migration).
- [ ] **Step 5: Commit** `git commit -m "Notifications table and the reminder check"`

### Task 2: Background reminder check for both databases

**Files:**
- Create: `src/aicity/reminder_loop.py`
- Modify: `src/aicity/main.py` (`create_app(..., background: bool = False)`; when true, start the loop on startup and stop it on shutdown via a FastAPI lifespan), `scripts/run_app.py` (`create_app(background=True)`)
- Test: `tests/test_reminder_loop.py`

**Interfaces:**
- Consumes: `NotificationStore.check_reminders` (Task 1), `db_path`, `open_database`, `DbKind`.
- Produces: `check_all_databases(clock: Callable[[], datetime], local_tz: tzinfo | None = None) -> dict[DbKind, int]` (only databases whose file exists; one failing database is logged and skipped, never raised), `class ReminderLoop: __init__(self, clock, every_seconds: float = 30.0)`, `start() -> None` (runs one check at once, then every `every_seconds`, on a daemon thread), `stop() -> None` (returns within a second).

- [ ] **Step 1: Write the failing tests:**

```python
def test_checks_both_databases_that_exist():          # Personal + Sample files with a due reminder each → {PERSONAL: 1, SAMPLE: 1}
def test_missing_database_file_is_skipped():          # only Sample exists → {SAMPLE: n}, no Personal file created
def test_a_broken_database_does_not_stop_the_other(): # Personal file of garbage bytes → Sample still checked, no exception
def test_loop_runs_at_start_and_stops_quickly():      # every_seconds=0.05 with a counting fake check; start(); stop() < 1 s; count >= 1
def test_create_app_does_not_start_the_loop_by_default():
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest tests/test_reminder_loop.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use `threading.Event().wait(every_seconds)` for the sleep so `stop()` is quick. Never open a database file that doesn't exist (`open_database` would create it).
- [ ] **Step 4: Run** the full suite. Expected: all pass.
- [ ] **Step 5: Commit** `git commit -m "Background reminder check for both databases"`

### Task 3: Notification routes

**Files:**
- Create: `src/aicity/notification_routes.py`
- Modify: `src/aicity/main.py` (call `notification_routes.register(app)`)
- Modify: `tests/test_get_routes_read_only.py` (add `/api/notifications` to `EXPECTED_AT_LEAST`)
- Test: `tests/test_notification_routes.py`

**Interfaces:**
- Consumes: `NotificationStore` (Task 1), `request.app.state.db_kind`, `request.app.state.clock`.
- Produces: `GET /api/notifications` → `{"mode": "sample"|"personal", "items": [{id, kind, task_id, title, due_at, seen}]}`; `POST /api/notifications/{id}/seen` and `/dismiss` with body `{"mode": "sample"|"personal"}` (strict pydantic model, `extra="forbid"`) → `{"ok": true}`; 404 not found; 409 conflict or wrong mode (`detail` says "The mode changed; refresh."); 503 settings missing (the existing app-wide `SettingsError` handler).

- [ ] **Step 1: Write the failing tests** (fixture as in `tests/test_task_routes.py`, with a fake clock; create tasks through `/api/tasks`, then call `NotificationStore(...).check_reminders()` on the Sample file directly to make notifications):

```python
def test_list_is_empty_at_first():
def test_list_shows_active_items_oldest_first_with_mode():
def test_seen_then_list_says_seen():
def test_dismiss_removes_it_from_the_list():
def test_dismiss_twice_is_409():
def test_unknown_id_is_404():
def test_wrong_mode_is_409_and_changes_nothing():   # current sample; body {"mode":"personal"} → 409; item still active and unseen
def test_bad_body_is_422():                          # missing mode, extra field
def test_list_does_not_run_the_check():             # due reminder, no check run → GET returns no items
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest tests/test_notification_routes.py -q`. Expected: FAIL (404s).
- [ ] **Step 3: Implement** following `task_routes.py` (router, a `_store(request)` context manager, `register(app)` adding 404/409 handlers for the two new errors).
- [ ] **Step 4: Run** the full suite. Expected: all pass, including the read-only GET test.
- [ ] **Step 5: Commit** `git commit -m "Notification routes: list, seen, dismiss (mode-checked)"`

### Task 4: Sample data shows a shuttle soon after a reset

**Files:**
- Modify: `src/aicity/sample_data.py`
- Test: `tests/test_sample_data.py`

**Interfaces:**
- Consumes: `SINCE_KEY` (Task 1).
- Produces: `SampleTask` gains `reminder_minutes_ago: int | None = None` (reminder at that many minutes before seeding, local time, to the minute). One new sample task: `"Water the balcony plants"`, `"personal"`, created 1 day ago, `reminder_minutes_ago=2`. `seed()` also writes `notifications_since` = seeding time minus 10 minutes (local, to the minute), so that reminder fires on the first check while the older made-up reminders don't.

- [ ] **Step 1: Write the failing tests:**

```python
def test_seed_sets_a_start_date_ten_minutes_back():
def test_first_check_after_seeding_makes_exactly_the_demo_notification():  # check at seed time → 1 item, "Water the balcony plants"
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest tests/test_sample_data.py -q`. Expected: the two new tests FAIL; update the existing task-count test to 13 tasks only if it fails on the count.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full suite. Expected: all pass.
- [ ] **Step 5: Commit** `git commit -m "Sample data: a reminder that fires right after a reset"`

### Task 5: Page rules (no 3D)

**Files:**
- Modify: `frontend/src/api.ts`, `frontend/src/belt/look.ts`
- Create: `frontend/src/notifications/rules.ts`, `frontend/src/notifications/shuttlePath.ts`, `frontend/src/notifications/journey.ts`, `frontend/src/todo/openRequest.ts`
- Test: `frontend/tests/notifications.test.ts`

**Interfaces:**
- `api.ts`: `type NotificationItem = { id: number; kind: "reminder"; task_id: number | null; title: string; due_at: string; seen: boolean }`; `type NotificationList = { mode: Mode; items: NotificationItem[] }`; `getNotifications()`, `markSeen(id: number, mode: Mode)`, `dismissNotification(id: number, mode: Mode)`.
- `look.ts`: `notifications: { flightSeconds: 7, gapSeconds: 1.5, rocketSize: 1.0, glowStrength: 1.0, bannerMaxChars: 48, tickerSecondsPerItem: 6, reducedMotionBannerSeconds: 5, maxSeparateShuttles: 3 }`.
- `rules.ts`:
  - `type ShuttleTrip = { ids: number[]; text: string }`
  - `planShuttles(unseen: NotificationItem[], maxSeparate: number): ShuttleTrip[]` (oldest first; up to `maxSeparate` trips of one; if more remain, one trip with all the rest and text `"+N more reminders"`)
  - `shortTitle(title: string, maxChars: number): string` (trim; cut at a word boundary when possible; add "…")
  - `bannerText(trip: ShuttleTrip): string` (`"REMINDER · " + text`, or the "+N more" text as is)
  - `tickerPosition(index: number, count: number): string` ("1 of 3"; "" when count ≤ 1)
  - `nextTickerIndex(index: number, count: number): number` (wraps; 0 when count is 0)
  - `queueAfterModeChange(prevMode: Mode | undefined, nextMode: Mode, queue: ShuttleTrip[]): ShuttleTrip[]` (empty when the mode changed)
- `shuttlePath.ts`: `shuttlePath(cameraPos: THREE.Vector3, cameraTarget: THREE.Vector3, fovDeg: number): { from: THREE.Vector3; via: THREE.Vector3; to: THREE.Vector3 }` (a gentle arc that starts just off one screen edge and ends just off the other, in front of the target at about 40 % of the camera's distance, a little above the target's height); `pointOnPath(p, k: number): THREE.Vector3` (quadratic Bézier).
- `journey.ts`: `stepsToTask(view: View): View[]` (from belt: `[building planner, screen planner]`; from inside Mission Control: `[screen planner]`; from the Vault: `[building planner, screen planner]` (room to room); from an asteroid: `[belt, building planner, screen planner]`; on Mission Control's screen: `[]`).
- `openRequest.ts`: `requestOpenTask(id: number): void`, `takeOpenTaskRequest(): number | null` (returns once, then null).

- [ ] **Step 1: Write the failing tests** in `frontend/tests/notifications.test.ts`:

```ts
test("up to three shuttles fly separately, the rest share a +N more shuttle")  // 5 unseen → 4 trips, last ids [4,5], text "+2 more reminders"
test("three or fewer: one trip each, oldest first")
test("long titles are cut at a word with an ellipsis; short ones are untouched")
test("banner text says REMINDER · title")
test("ticker shows 1 of 3, nothing for a single item, and wraps")
test("a mode change empties the shuttle queue; the same mode keeps it")
test("the shuttle path starts and ends off screen on opposite sides, from any camera angle")  // project from/to with a PerspectiveCamera at 4 angles: |x| > 1, signs differ; via inside the view
test("steps to a task from the belt, Mission Control, the Vault, an asteroid and its screen")
test("an open-task request is taken once")
```

- [ ] **Step 2: Run** `cd frontend && npm test`. Expected: the new file fails (missing modules).
- [ ] **Step 3: Implement** all of the above.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: all pass.
- [ ] **Step 5: Commit** `git commit -m "Notification rules: shuttle queue, ticker, path, journey"`

### Task 6: The shuttle in the scene

**Files:**
- Create: `frontend/src/notifications/Shuttle.tsx` (R3F: rocket mesh + engine glow sprite; flies `pointOnPath` over `LOOK.notifications.flightSeconds`, banked along its direction; each frame writes the banner's screen position to a DOM element ref, hidden when behind the camera), `frontend/src/notifications/ShuttleBanner.tsx` (the HTML ribbon), `frontend/src/notifications/useNotifications.ts`, `frontend/src/notifications/notifications.css`
- Modify: `frontend/src/belt/BeltCanvas.tsx` (banner element and the hook), `frontend/src/belt/BeltScene.tsx` (render `<Shuttle>` when a trip is active)

**Interfaces:**
- Consumes: Task 5 rules, `getNotifications`, `markSeen`, `flightState.flying()`, `LOOK.notifications`, the view level.
- Produces: `useNotifications(): { mode: Mode | undefined; items: NotificationItem[]; trip: ShuttleTrip | null; tripDone(): void; dismiss(id: number): void }`. Polls every 30 s and when the page becomes visible. A trip starts only when the view is the belt, no camera flight is running, and the previous trip ended `gapSeconds` ago. `tripDone` marks every id in the trip seen (with the mode the list came with). A mode change (from the list's `mode`) empties the queue and ends the current trip without marking it seen.
- Look: white hull and royal-blue fins (`#3456e0`), dark window; about a sixth of the station's length (station is about 25 units wide); engine glow: additive soft sprite under and behind, scaled by `glowStrength`, placed so it never overlaps the banner (banner sits behind the rocket on screen, glow below its line). Banner: cyan hologram ribbon from the mockup (`.superpowers/brainstorm/…/shuttle-style.html` option B), bright text ≥ 17 px with a faint dark band for contrast, `REMINDER · <title>`.
- Reduced motion: no `<Shuttle>`; the banner shows fixed at top centre for `reducedMotionBannerSeconds`, then `tripDone()`.

- [ ] **Step 1: Implement** (visual; the rules it uses are tested in Task 5).
- [ ] **Step 2: Live check** with a throwaway data folder: a task with a reminder one minute ahead fires a shuttle across the belt; the text is readable; the rocket is in proportion; the glow sits under the rocket clear of the text; in Night too; inside a building the shuttle waits and flies on return; 5 due at once → 3 + "+2 more"; switching to Sample mid-flight removes it; reduced motion shows the top banner.
- [ ] **Step 3: Run** `cd frontend && npm test && npm run typecheck && npm run build`. Expected: pass.
- [ ] **Step 4: Commit** `git commit -m "Notification shuttle: rocket with holographic banner"`

### Task 7: Ticker, opening a task, runbook

**Files:**
- Create: `frontend/src/notifications/Ticker.tsx`
- Modify: `frontend/src/App.tsx` (render the ticker at belt and building levels, not on the screen; run a journey from `stepsToTask(view)`: go to each step after the previous flight has ended, asking `confirmLeave()` once at the start), `frontend/src/todo/TodoPanel.tsx` (on mount and when a request arrives, `takeOpenTaskRequest()` opens that task), `docs/RUNBOOK.md` (what the shuttle and ticker are, Dismiss, "a reminder didn't show" fix: the app must be running; old reminders from before the first run are skipped on purpose; check the mode)

**Interfaces:**
- Consumes: `useNotifications` (Task 6), `tickerPosition`, `nextTickerIndex`, `stepsToTask`, `requestOpenTask` (Task 5), `go()` in `App.tsx`, `flightState`.
- Ticker: glass strip at the bottom centre; one item at a time with its title, "1 of N", **Dismiss**; advances every `tickerSecondsPerItem` (not with reduced motion: small ‹ › buttons instead); clicking the title calls `requestOpenTask(task_id)` then starts the journey. Hidden when there are no items. Keyboard reachable; `aria-live="polite"`.

- [ ] **Step 1: Implement.**
- [ ] **Step 2: Live check** (throwaway data folder): ticker cycles; Dismiss removes; finishing the task clears it within 30 s; clicking from the belt, the Vault and an asteroid flies into Mission Control and opens the task; with unsaved edits the discard question comes first; reduced motion jumps; not shown on the computer screen.
- [ ] **Step 3: Run the full checks from scratch:** clear `__pycache__` and `.pytest_cache`; `.venv/bin/python -m pytest -q`; `.venv/bin/ruff check . && .venv/bin/ruff format --check .`; `cd frontend && npm test && npm run typecheck && npx prettier --check src tests && npm run build`; `gitleaks git --no-banner .`; blocked words over every tracked file; `graphify update .`.
- [ ] **Step 4: Commit** `git commit -m "Ticker and open-task journey; runbook"`
