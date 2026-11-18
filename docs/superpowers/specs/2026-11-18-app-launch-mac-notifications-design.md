# Opening like an app, starting by itself, and Mac notifications: design

Drafted 2026-11-18, builder-checked. Size: a project (full design).

## Intent

The Phase 1a milestone is that the owner opens the app daily for a week. Today it only runs from
two Terminal windows, and reminders only fire while it's running. This makes the app behave like
an installed Mac app: it starts by itself at login, opens from the Dock, and nudges the owner with
a normal Mac notification when a reminder comes due and the app window is closed (SPEC section 3:
"added to the Dock so it opens like an app"; section 6: "a small background service (launchd)";
section 7: "macOS notifications fire for things that matter when the app is closed").

## Goals
- The backend serves the built page itself at `http://127.0.0.1:8765` (no dev server needed).
- A login item (launchd agent) starts the backend at login and restarts it if it stops.
- The page can be added to the Dock (Safari: File → Add to Dock) and opens in its own window.
- A Mac notification for a Personal reminder that comes due while no app window is open. Clicking
  it opens the app.
- One-command install and uninstall of the login item; runbook steps written to be followed tired.

## Non-goals
- Phone access (Phase 2). Any hosting or network access beyond this Mac.
- Notifications for anything but reminders (only source today).
- A full native Mac app; the "app" is the Safari Dock web app.

## Anti-goals
- A real task title appearing on screen while the app is in Sample mode (demos and recordings).
- Two nudges for one reminder (a Mac notification and a shuttle at the same moment).
- A flood of notifications after the Mac wakes with several reminders due.
- Anything listening beyond 127.0.0.1; any download or third-party install.
- A login item that can't be removed cleanly.

## Decisions made with Steve (2026-11-18)
- **Personal reminder while in Sample mode (option A):** the Mac notification shows no title, just
  "You have a reminder". Sample's made-up reminders never make Mac notifications.
- **Delivery (option 1):** a tiny notifier app compiled on this Mac (like the Touch ID helper), so
  notifications show as "Asteroid Belt" with its own icon and clicking opens the app. A throwaway
  test proved a locally built, ad-hoc signed app can post notifications on macOS 26.6 once allowed
  (it must be launched as an app via `open`, from a normal folder, and registered with
  LaunchServices; the first run asks for permission).
- **After a Mac notification the shuttle still flies** when the app is next opened (option A): a
  second, friendlier nudge; the reminder stays in the ticker either way. Mac notifications don't
  mark anything seen.

## Approaches considered (notification delivery)
1. **Local notifier app (chosen).** Proper name, icon and click; nothing downloaded.
2. `osascript` "display notification": no setup, but shows as "Script Editor" and clicking opens
   Script Editor.
3. `terminal-notifier` via Homebrew: works, but third-party software.

## Design

### Serving the page
- In normal (not dev) mode the backend serves `frontend/dist`: `/assets/*` as files, and every other
  non-`/api` path returns `index.html` (the page's own router handles `/b/<id>` etc.). If
  `frontend/dist` is missing, those paths answer a short plain page saying to run
  `cd frontend && npm run build` (runbook step).
- `/api/*` behaviour is unchanged. The front-door middleware already limits hosts to this Mac and
  checks origins on writes; same-origin page requests pass.
- Dev mode (`AICITY_DEV=1` + Vite on 5173) keeps working as now.

### The app's own stable copy (my call, from the builder check)
- The login item never runs the working tree being developed in. It runs a separate copy of the
  latest merged code: a git worktree at `~/Projects/ai-city-app`, detached at `origin/main`, using
  this repo's `.venv` and `frontend/node_modules` (no second install).
- `scripts/app.py` with four commands, each printing what it did:
  - `update`: fetch, move the copy to the latest `origin/main`, build its page and notifier,
    restart the app. Run after each merge.
  - `stop` / `start`: pause the app (e.g. while a dev backend needs port 8765) and bring it back.
  - `status`: is it loaded and answering, which commit it runs.
- The runbook says: after merging a PR, run `update`; before dev work with `AICITY_DEV=1`, `stop`;
  after, `start`.

### The login item
- `scripts/install_login_item.py` writes `~/Library/LaunchAgents/local.asteroidbelt.app.plist`
  (runs the stable copy's `scripts/run_app.py` with this repo's `.venv/bin/python`; `RunAtLoad`, `KeepAlive`; output to
  `<data folder>/logs/app.log` and `app.err.log`), then loads it with `launchctl bootstrap gui/<uid>`.
  It refuses to run if `frontend/dist` or the notifier is missing, and says which build command to
  run. Running it again replaces the old one cleanly.
- `scripts/uninstall_login_item.py` unloads it (`launchctl bootout`) and deletes the plist. Nothing
  else is touched.
- Both print exactly what they did. The plist holds paths only (no personal data, no secrets).

### "Is the owner looking at the app?" (my call, from the builder check)
- A window merely open behind other apps doesn't count: the shuttle would fly unseen. The page adds
  `?looking=1` to `GET /api/notifications` when `document.hasFocus()` is true, and asks again
  whenever the window gains or loses focus (besides the 30 s poll).
- The backend records, in memory only (the GET still changes no data on disk), the time of the last
  request with `looking=1` and the last with `looking=0`. The owner counts as looking if the latest
  of those said 1 and was within the last 75 s.

### Which reminders make a Mac notification
- Only reminders newly created by the background check in the **Personal** database.
- If the owner is looking at the app **and** the current mode is Personal: no Mac notification (the
  shuttle and ticker show it).
- Otherwise (not looking, window closed, or the mode is Sample): a Mac notification.
- Title: "Reminder"; body: the task title (cut to one line), except when the current mode is Sample:
  body "You have a reminder" (Steve, option A).
- Several in one check: one notification, "3 reminders came due" (titles not listed), so waking the
  Mac never floods.
- Reminders before the start date are already skipped (notifications design), so the first run
  never notifies about old reminders.

### The notifier app
- `helpers/notifier.swift` + `scripts/build_notifier.py` build `build/Asteroid Belt Notifier.app`
  (bundle id `local.asteroidbelt.notifier`, `LSUIElement`, an icon drawn at build time), ad-hoc
  signed and registered with LaunchServices. git-ignored, like `build/confirm-owner`.
- Posting: the backend runs `open -n -g "<app>" --args --title T --body B` (no shell; arguments as a
  list). The app posts and quits. A failure to post is logged (type only) and never stops the check.
- Clicking a notification (my call, from the builder check): macOS launches the notifier with no
  arguments; it opens the Safari Dock app (`~/Applications/Asteroid Belt.app`, the name the runbook
  tells the owner to use) if it exists, otherwise `http://127.0.0.1:8765` in the default browser,
  and quits.
- Names: the notifier's file is `build/Asteroid Belt Notifier.app` (so it never shares a name with
  the Dock app), but its display name, shown on every notification, is "Asteroid Belt".
- If the notifier hasn't been built, notifications are simply skipped (logged once).

### Touch ID under the login item (my call, from the builder check)
- The Sample → Personal switch shows the Mac's Touch ID prompt from `build/confirm-owner`, started by
  the backend. Under launchd it's started by a background process, so it is checked live early
  (straight after the login item first runs). If the prompt doesn't appear, work stops and the owner
  is told before anything else is built on it.

### Docs
- Runbook: build the page, build the notifier (and click Allow on first notification), install the
  login item, add to Dock in Safari, uninstall, "the app doesn't open" fixes, where logs are.

### Tests
- Backend: serving (`/` and `/b/planner/screen` give index.html; `/assets/x.js` the file; `/api/*`
  untouched; missing dist gives the build hint; path tricks like `/assets/../../settings` refused);
  window-open tracking; the Mac-notification rule (Personal only, window open + Personal mode
  skips, Sample mode hides the title, several → one summary); the notifier call is made with a
  list of arguments and is skipped when the app is missing (with a fake runner, nothing posted
  for real); the plist content (paths, RunAtLoad, KeepAlive, logs) and install/uninstall commands
  (with a fake `launchctl` runner).
- Live: install the login item, app answers; Touch ID switch works under it; window behind other
  apps or closed → a reminder posts a Mac notification; click opens the Dock app; Sample mode hides
  the title; the shuttle still flies on return; `app.py stop/start/update/status`; uninstall
  removes it.

## Left to the builder
The icon's drawing, exact log file names, how long the click-launched app waits for the click
event before quitting, and the plain "build the page" message wording.
