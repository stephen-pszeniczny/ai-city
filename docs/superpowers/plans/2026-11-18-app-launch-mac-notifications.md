# Open Like an App, Start at Login, Mac Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app starts at login from a stable copy of the merged code, opens from the Dock as its own window, and posts a Mac notification (as "Asteroid Belt") when a Personal reminder comes due and the owner isn't looking at the app.

**Architecture:** The backend serves the built page in normal mode. The page tells the backend whether its window has focus; the backend keeps that in memory. The background reminder check passes newly created Personal notifications to a pure rule that decides the Mac messages, posted through a small notifier app compiled on this Mac. A launchd agent runs a detached git worktree of `origin/main`, managed by `scripts/app.py`.

**Tech Stack:** Python 3 + FastAPI + pytest; Swift (UserNotifications, AppKit) compiled with `swiftc`; launchd (`launchctl`); React + TypeScript + @tanstack/react-query; `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-18-app-launch-mac-notifications-design.md`

## Global Constraints

- Everything stays on this Mac: the server listens on 127.0.0.1 only; nothing is downloaded or installed from outside.
- GET routes change no data on disk (in-memory state is fine; `tests/test_get_routes_read_only.py` must pass).
- Sample's made-up reminders never make Mac notifications. While the current mode is Sample, a Personal reminder's Mac notification body is exactly "You have a reminder" (no title).
- Several reminders in one check → one notification: title "Reminders", body "<N> reminders came due".
- Subprocesses are always called with a list of arguments, never a shell string. Logs print kinds and error types only, never titles or paths.
- Notifier file: `build/Asteroid Belt Notifier.app`, bundle id `local.asteroidbelt.notifier`, display name "Asteroid Belt". The Dock app the runbook asks for is named exactly "Asteroid Belt" (`~/Applications/Asteroid Belt.app`).
- Login item: `~/Library/LaunchAgents/local.asteroidbelt.app.plist`; stable copy: `~/Projects/ai-city-app` (detached at `origin/main`).
- After code changes run `graphify update .`.

## Review Focus

1. **The page isn't built, or a path tries to escape `frontend/dist`** (`/assets/../../settings/settings.toml`): a clear "build the page" answer or 404, never a file outside dist. Pinned in Task 1.
2. **The window is open but behind other apps, or was closed without a final "not looking":** counts as not looking after 75 s at most, so the Mac notification still comes. Pinned in Task 2.
3. **The notifier isn't built, or posting fails:** the reminder check carries on, the ticker still gets it, one log line. Pinned in Task 4.
4. **Five Personal reminders in one check while in Sample mode:** one notification, no titles anywhere. Pinned in Task 3.
5. **Running install twice, uninstall when nothing is installed, `app.py update` with uncommitted changes in the stable copy:** each does the safe thing and says what it did. Pinned in Task 5.

---

### Task 1: The backend serves the built page

**Files:**
- Create: `src/aicity/page.py`
- Modify: `src/aicity/main.py` (call `page.register(app, dist=...)` last, only when `dev` is false)
- Test: `tests/test_page.py`

**Interfaces:**
- Produces: `DIST = REPO_ROOT / "frontend" / "dist"` and `register(app: FastAPI, dist: Path = DIST) -> None`: `GET /assets/{path}` serves files under `dist/assets` (resolved path must stay inside it, else 404); any other non-`/api` GET returns `dist/index.html` (`text/html`). If `dist/index.html` is missing, those answer 503 with a short plain-text page: `The page isn't built yet. Run: cd frontend && npm run build`.

- [ ] **Step 1: Write the failing tests** (a tmp `dist` with `index.html` and `assets/app.js`; `create_app(dev=False)` then `page.register` with that dist via a `create_app(..., dist=...)` parameter):

```python
def test_root_serves_the_page():
def test_deep_links_serve_the_page():          # /b/planner/screen and /todo → index.html
def test_assets_are_served_with_their_type():   # /assets/app.js → 200, javascript content type
def test_missing_asset_is_404():
def test_path_escape_is_refused():              # /assets/../../secret.txt and %2e%2e variants → 404, never the file
def test_api_routes_still_answer():             # /api/health → {"status": "ok"}; unknown /api/nope → 404 JSON, not the page
def test_missing_build_says_how_to_build():     # no index.html → 503 with the build command
def test_dev_mode_does_not_serve_the_page():    # create_app(dev=True) → "/" is 404
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest tests/test_page.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.** `create_app` gains `dist: Path | None = None` (None → `page.DIST`).
- [ ] **Step 4: Run** the full suite. Expected: all pass.
- [ ] **Step 5: Commit** `git commit -m "Backend serves the built page"`

### Task 2: "Is the owner looking at the app?"

**Files:**
- Create: `src/aicity/presence.py`
- Modify: `src/aicity/notification_routes.py` (`GET /api/notifications?looking=0|1`, records it), `src/aicity/main.py` (`app.state.presence = Presence(clock)`)
- Modify: `frontend/src/api.ts` (`getNotifications(looking: boolean)`), `frontend/src/notifications/useNotifications.ts` (send `document.hasFocus()`; refetch on window `focus` and `blur`)
- Test: `tests/test_presence.py`, `tests/test_notification_routes.py`

**Interfaces:**
- Produces: `class Presence: __init__(self, clock: Callable[[], datetime], window_seconds: float = 75)`, `report(looking: bool) -> None`, `looking() -> bool` (true only if the latest report said looking and is within `window_seconds`). Thread-safe (a lock): the route thread writes, the loop thread reads.

- [ ] **Step 1: Write the failing tests:**

```python
def test_nobody_has_reported_means_not_looking():
def test_looking_report_counts_for_75_seconds():        # report(True) at t; looking() at t+74 True, t+76 False
def test_a_later_not_looking_report_wins():             # True then False → False
def test_route_records_looking_flag():                  # GET ?looking=1 → app.state.presence.looking() True; ?looking=0 → False
def test_route_without_flag_counts_as_not_looking():
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest tests/test_presence.py tests/test_notification_routes.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** backend and frontend (query key stays `["notifications"]`; the flag is read at fetch time).
- [ ] **Step 4: Run** the full backend suite and `cd frontend && npm test && npm run typecheck`. Expected: pass (the read-only GET test still passes).
- [ ] **Step 5: Commit** `git commit -m "The page reports whether its window has focus"`

### Task 3: Which reminders make a Mac notification

**Files:**
- Create: `src/aicity/mac_messages.py`
- Modify: `src/aicity/notifications.py` (`last_id() -> int`, `created_after(nid: int) -> list[Notification]` (active only, oldest first))
- Test: `tests/test_mac_messages.py`, `tests/test_notifications.py`

**Interfaces:**
- Produces: `@dataclass(frozen=True) class MacMessage: title: str; body: str` and `plan_mac_messages(new_titles: list[str], *, sample_mode: bool, looking: bool, max_chars: int = 60) -> list[MacMessage]`:
  - no titles → `[]`; mode Personal and looking → `[]`;
  - one title → `[MacMessage("Reminder", "You have a reminder" if sample_mode else <title cut to max_chars with "…">)]`;
  - several → `[MacMessage("Reminders", f"{n} reminders came due")]`.

- [ ] **Step 1: Write the failing tests:**

```python
def test_nothing_new_nothing_to_say():
def test_looking_in_personal_mode_stays_quiet():
def test_one_reminder_shows_its_title_when_not_looking():
def test_sample_mode_never_shows_the_title():          # looking or not
def test_several_become_one_summary_without_titles():  # 5 titles, sample_mode False and True → one, no title text in it
def test_long_title_is_cut():
def test_created_after_lists_only_the_new_ones():       # notifications.py
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest tests/test_mac_messages.py tests/test_notifications.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full suite. Expected: pass.
- [ ] **Step 5: Commit** `git commit -m "Rule for which reminders make a Mac notification"`

### Task 4: The notifier app, and the check posting through it

**Files:**
- Create: `helpers/notifier.swift`, `scripts/build_notifier.py`, `src/aicity/mac_notify.py`
- Modify: `src/aicity/reminder_loop.py` (`check_all_databases` returns `dict[DbKind, list[Notification]]`-backed counts as today plus calls a `notify` callback with the Personal database's new notifications), `src/aicity/main.py` (the loop's notify callback reads `app.state.db_kind` and `app.state.presence.looking()`, plans with `plan_mac_messages`, posts with `post`)
- Test: `tests/test_mac_notify.py`, `tests/test_reminder_loop.py`

**Interfaces:**
- `mac_notify.py`: `NOTIFIER_APP = REPO_ROOT / "build" / "Asteroid Belt Notifier.app"`; `post(message: MacMessage, app: Path = NOTIFIER_APP, run: Callable[..., object] = subprocess.run) -> bool` → runs `["open", "-n", "-g", str(app), "--args", "--title", title, "--body", body]` (`check=False`, `timeout=10`); returns False (and logs once per process) when the app folder is missing; never raises.
- `reminder_loop.check_all_databases(clock, local_tz=None, notify: Callable[[list[Notification]], None] | None = None) -> dict[DbKind, int]` (unchanged counts; `notify` called once per check with Personal's new notifications, only if any; an exception inside `notify` is logged and swallowed).
- `notifier.swift`: with `--title T --body B`: request authorisation (first run prompts), post, wait for the add callback (≤ 10 s), exit. With no arguments (launched by a click): set itself as the notification-centre delegate, on the click response open `~/Applications/Asteroid Belt.app` if it exists else `http://127.0.0.1:8765` (NSWorkspace), exit; quit after 5 s if no response arrives.
- `build_notifier.py`: compiles into `build/Asteroid Belt Notifier.app/Contents/MacOS/notifier`, writes `Info.plist` (`CFBundleIdentifier local.asteroidbelt.notifier`, `CFBundleDisplayName` and `CFBundleName` "Asteroid Belt", `LSUIElement` true), draws a simple station icon into `Contents/Resources/AppIcon.icns` (AppKit drawing at build time + `iconutil`), ad-hoc signs (`codesign --force --sign -`), registers (`lsregister -f`). Prints what it did. macOS only; nothing downloaded.

- [ ] **Step 1: Write the failing tests:**

```python
def test_post_runs_open_with_a_list_of_arguments():   # fake run records args; exact list; no shell
def test_post_skips_quietly_when_the_app_is_missing():
def test_post_survives_a_failing_open():              # fake run raises OSError → False, no exception
def test_loop_hands_personal_new_notifications_to_notify():  # Personal + Sample due reminders → notify gets Personal ones only
def test_loop_survives_a_failing_notify():
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest tests/test_mac_notify.py tests/test_reminder_loop.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement**, then run `.venv/bin/python scripts/build_notifier.py`.
- [ ] **Step 4: Run** the full suite. Live: `open -n -g "build/Asteroid Belt Notifier.app" --args --title Reminder --body "Test"` shows a notification named "Asteroid Belt" with the icon (owner allows on first prompt); clicking opens the page.
- [ ] **Step 5: Commit** `git commit -m "Notifier app and Mac notifications from the reminder check"`

### Task 5: The stable copy and the login item

**Files:**
- Create: `scripts/app.py`, `src/aicity/login_item.py`
- Test: `tests/test_login_item.py`

**Interfaces:**
- `login_item.py`: `LABEL = "local.asteroidbelt.app"`, `PLIST = ~/Library/LaunchAgents/local.asteroidbelt.app.plist`, `APP_COPY = ~/Projects/ai-city-app`; `plist_text(python: Path, app_copy: Path, logs: Path) -> str` (ProgramArguments `[python, app_copy/scripts/run_app.py]`, `WorkingDirectory` app_copy, `RunAtLoad` true, `KeepAlive` true, `StandardOutPath logs/app.log`, `StandardErrorPath logs/app.err.log`, no `AICITY_DEV`); `install(run=subprocess.run, ...)`, `uninstall(run=...)`, `status(run=...) -> str`. All `launchctl` calls via the injected `run` with list arguments (`bootstrap gui/<uid> <plist>`, `bootout gui/<uid>/<label>`, `print gui/<uid>/<label>`).
- `scripts/app.py`: `update` (refuses if the stable copy has uncommitted changes; `git fetch`; `git -C APP_COPY checkout --detach origin/main` (creates the worktree with `git worktree add --detach` if missing); symlinks `frontend/node_modules` from this repo; builds the copy's page (`npm run build`), Touch ID helper and notifier; then `install`), `stop` (`bootout`), `start` (`bootstrap`), `status`, `uninstall` (stop + delete the plist; leaves the copy). Each prints what it did.

- [ ] **Step 1: Write the failing tests** (fake runner, tmp paths):

```python
def test_plist_runs_the_stable_copy_with_logs_and_restarts():
def test_plist_never_turns_on_dev_mode():
def test_install_writes_the_plist_and_bootstraps():       # replaces an existing one: bootout first, ignore "not loaded"
def test_install_twice_is_safe():
def test_uninstall_when_nothing_is_installed_says_so():
def test_update_refuses_a_copy_with_uncommitted_changes():
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest tests/test_login_item.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the full suite. Expected: pass.
- [ ] **Step 5: Commit** `git commit -m "Stable app copy and login item"`

### Task 6: Live run, Touch ID under launchd, runbook

**Files:**
- Modify: `docs/RUNBOOK.md` (section 2 rewritten: first-time setup in order — build page, build helpers, `app.py update`, allow notifications, Safari → File → Add to Dock named "Asteroid Belt"; daily use; after merging a PR `app.py update`; before dev work `app.py stop`, after `start`; uninstall; common fixes: app doesn't open / no notifications / where the logs are)

- [ ] **Step 1: Live, with the owner present** (this touches the owner's login items and the real app; tell the owner before each step that needs them):
  1. Stop the dev servers. `app.py update` → `status` shows loaded and answering at http://127.0.0.1:8765, running the merged commit.
  2. **Touch ID under launchd:** in the page, switch Sample → Personal; the owner sees the Touch ID prompt and cancels (stays in Sample). If no prompt appears: stop and report.
  3. Mac notifications, never on real data: `app.py stop`, then run the working tree's backend with `AICITY_DATA_DIR=<scratchpad throwaway>` (background on), make a made-up Personal database there with a reminder a minute ahead (directly through `TaskStore`, no Touch ID needed), and check: window unfocused → "Reminder" + title; mode Sample → "You have a reminder"; several at once → one summary; clicking opens the Dock app (or the browser). Then delete the throwaway folder and `app.py start`.
  4. `app.py stop` → page unreachable; `start` → back.
- [ ] **Step 2: Run the full checks from scratch** (pytest, ruff, frontend tests, typecheck, prettier, build, gitleaks, blocked words, `graphify update .`).
- [ ] **Step 3: Commit** `git commit -m "Runbook: install, update, Dock, notifications"`
