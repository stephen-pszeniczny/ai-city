# Asteroid Belt Runbook

How to run, back up, fix and recover Asteroid Belt. Written to be followed when tired: do the steps in order, don't skip.

If something here is out of date, tell Claude Code: "the runbook is wrong about X, fix it."

---

## 1. Where things live

| What | Where | In GitHub? |
|---|---|---|
| Code | `~/Projects/ai-city` | Yes (public) |
| Your data (database, statements, resume, exports, logs) | `~/AI-City-Data` | **Never** |
| API keys and Gmail tokens | macOS Keychain | **Never** |
| Backups | External drive, encrypted | **Never** |

## 2. Start and stop the app

The app starts by itself when you log in (a login item) and runs from its own copy of the
latest merged code at `~/Projects/ai-city-app`. You open it from the Dock. All commands below
run in Terminal from `~/Projects/ai-city`.

**First-time setup** (once, in this order)
1. `.venv/bin/python scripts/app.py update` → makes the app's copy, builds it, installs the
   login item and starts it. It ends with "Answering … yes".
2. Open **Safari** and go to http://127.0.0.1:8765 → menu **File → Add to Dock…** → name it
   exactly **Asteroid Belt** → **Add**. (Clicking a reminder notification opens this.)
3. The first reminder notification makes macOS ask about notifications from "Asteroid Belt":
   click **Allow**. Changed your mind? System Settings → Notifications → Asteroid Belt.

**Every day** → click **Asteroid Belt** in the Dock. Nothing else to start.

**After merging a pull request** → `.venv/bin/python scripts/app.py update`.

**Is it running? Which version?** → `.venv/bin/python scripts/app.py status`.

**Pause / resume it** → `.venv/bin/python scripts/app.py stop` / `start`. (Needed before a
development session, which uses the same address.) A pause lasts until you run `start` or log in
again; logging in always starts it.

**Remove the login item** → `.venv/bin/python scripts/app.py uninstall`. Your data and the app's
copy stay; run `update` to put it back.

**Logs** → `~/AI-City-Data/logs/app.log` and `app.err.log`.

**While building the page** (development, two Terminal windows):
1. `.venv/bin/python scripts/app.py stop` first (it uses port 8765).
2. Window 1: `cd ~/Projects/ai-city && AICITY_DEV=1 .venv/bin/python scripts/run_app.py`
3. Window 2: `cd ~/Projects/ai-city/frontend && npm run dev`, then open http://127.0.0.1:5173
4. Done: Ctrl+C in both windows, then `.venv/bin/python scripts/app.py start`.

**If it says "Refusing to start: HOST must be 127.0.0.1"** → someone changed `HOST` in `src/aicity/config.py`. Change it back to `"127.0.0.1"`. The app is for this Mac only.

**If it says `address already in use`** → it's already running somewhere. Find that window and press Ctrl+C. Can't find it? Run `lsof -nP -iTCP:8765 -sTCP:LISTEN`, note the number in the PID column, then run `kill <that number>` and start again.

**Which data it uses:** the Sample | Personal switch at the top right of the belt. The app opens in whichever mode you used last (Sample the very first time). Going to Personal asks for Touch ID, or your Mac password.

**One-time setup for the switch** → `.venv/bin/python scripts/build_touch_id_helper.py`. It compiles the small Touch ID program into `build/confirm-owner`. Re-run it after a fresh clone or after changing `helpers/confirm_owner.swift`.

**Made-up Sample tasks** → added once, the first time the app starts with a Sample database that doesn't have them yet. They only ever go into the Sample file.

**Day and night** → the **Sky** button next to the switch cycles Auto → Day → Night. Auto follows sunrise and sunset at the `[location]` in your settings file, worked out on this Mac. Day or Night stays until you set it back to Auto. The choice is remembered in this browser only.

**Reminders (the shuttle and ticker)** → when a task's reminder time arrives, a small rocket flies across the belt towing a banner with the task's title, and the reminder joins the ticker at the bottom of the screen. Click its title to fly to the task; **Dismiss** takes it off the ticker; finishing the task clears it too. Reminders are checked every 30 seconds while the app is running, for both Personal and Sample (each shows only in its own mode). Reminders set before the very first run are skipped on purpose; ones that came due while the Mac was off or asleep show up as soon as the app is running again.

**Fresh Sample data before a demo** → `.venv/bin/python scripts/reset_sample_data.py`, then type `reset`. It deletes only the file labelled Sample and refills it with made-up tasks; Personal is never opened. Fine to run while the app is running.

## 3. Back up

_To be filled in when the external drive is set up (Phase 0)._

## 4. Restore from backup

_To be filled in when the external drive is set up (Phase 0)._

## 5. Update

### Code
After a pull request is merged on GitHub: `cd ~/Projects/ai-city && git checkout main && git pull`, then
`.venv/bin/python scripts/app.py update` (refreshes the app's own copy, rebuilds it, restarts it).

### Libraries (Python and Node packages)
_To be filled in during Phase 1a._

### Tools (Homebrew, Ollama, models)
_To be filled in when the first AI feature is built._

## 6. Common fixes

_Added as problems come up. Format: **Symptom** → what to do._

**After any fresh clone** → run `git config core.hooksPath .githooks` inside the repo. That setting isn't copied with the repo, and without it the gitleaks secret check won't run on commits. Needs `brew install gitleaks` first.

**Switching to Personal says "Touch ID isn't available"** → run the one-time setup above, then try again. You stay in Sample until it works.

**The belt is in the wrong mode for the time of day** → check the Sky button says Auto. Then check `[location]` in your settings file: latitude, longitude (west is negative) and `timezone`, which must be a name from the standard list, like `Europe/London`. No restart needed: reload the page to see the change. If the backend is down, Auto shows day.

**Mac notifications** → when a Personal reminder comes due and you're not looking at the app (window closed, or behind other windows), a Mac notification from "Asteroid Belt" appears; click it to open the app. While the app is in Sample mode it only says "You have a reminder" (never the task), so nothing real shows during a demo. Several at once come as one ("3 reminders came due"). Sample's made-up reminders never make Mac notifications. The shuttle still flies when you next look at the app.

**No Mac notifications** → check `scripts/app.py status` says it's running; check System Settings → Notifications → Asteroid Belt is allowed; if the app was never built, `scripts/app.py update` builds the notifier.

**Notifications only say "Asteroid Belt / Notification", no text** → macOS is hiding previews. System Settings → Notifications → **Show previews**: set it to **Always** (or When Unlocked), and under Asteroid Belt set its own **Show previews** to Always.

**The app doesn't open from the Dock** → run `scripts/app.py status`. Not loaded → `scripts/app.py start`. Loaded but not answering → look at the end of `~/AI-City-Data/logs/app.err.log`; a message about port 8765 means a development backend is still running (Ctrl+C it, then `start`). "The page isn't built yet" → `scripts/app.py update`.

**A reminder didn't show** → check the app is running (reminders are only checked while it is). Check you're in the right mode: Personal reminders never show in Sample. If the reminder time was before the app's very first notification check, it's skipped on purpose. A reminder you just saved fires within 30 seconds; the shuttle waits while you're inside a building and flies when you're back on the belt.

**The Vault asks for Touch ID** → that's expected: once per app session in Personal mode, the first time you open Side work. Reloading the page, restarting the app or switching modes locks it again. Sample mode never asks.

**Adding a side-work platform's pay schedule** → in the settings file, add a block like the commented `[pay_schedules.platform_a]` example in `settings.example.toml`: a short lowercase id, the name to show, the weekday pay weeks start on, and `[earliest, latest]` day counts for release and arrival. Restart the app (`scripts/app.py stop` then `start`). The platform then appears in the Log work company list, and its entries get expected pay and a "lands …" window. A week only counts as overdue after the latest day.

**Side work says "rate pending"** → the app couldn't get that day's USD→CAD rate from the Bank of Canada (no internet, or the day's rate isn't published yet: it appears late afternoon). It fills in on its own the next time you open Side work. If it's urgent, type the rate into the box that appears (the Bank of Canada's daily rate for that day). Weekends and holidays use the last business day's rate.

**A commit is blocked by gitleaks** → read the RuleID it printed. If it's a real secret or account number, follow section 7, Case A. If it's a false positive, ask Claude Code to add a narrow allowlist entry to `.gitleaks.toml`. Never disable the rule, and never use `--no-verify`.

---

## 7. 🚨 Emergency: a secret or personal data may have been committed

A "secret" is an API key, a Gmail token, a GitHub token or a password.
"Personal data" is anything from `~/AI-City-Data`: a statement, your resume, the database, email, day-job notes.

**Stay calm. Work out which case you're in, then follow only that section.**

```
cd ~/Projects/ai-city
git status          # is it only staged, or already committed?
git log origin/main..HEAD --oneline   # commits listed here have NOT been pushed yet
```

### Case A: it's staged but not committed

1. Unstage it: `git restore --staged <file>`
2. Move the file to `~/AI-City-Data` (or delete it if it's a stray copy).
3. Ask Claude Code to add a pattern to `.gitignore` so it can't happen again, then check: `git status --ignored`
4. Done. Nothing left your Mac.

### Case B: it's committed but NOT pushed

The commit is still only on your Mac.

1. **Do not push.**
2. If it's in the most recent commit:
   ```
   git rm --cached <file>
   git commit --amend --no-edit
   ```
3. If it's in an older commit, stop and ask Claude Code: "a secret is in an unpushed commit, remove it from history." Don't try to rewrite history from memory.
4. Confirm it's gone: `git log --all --stat | grep <filename>` should print nothing.
5. Add a `.gitignore` pattern (as in Case A).
6. A secret that never left the Mac doesn't need replacing, but replacing it anyway is cheap peace of mind.

### Case C: GitHub blocked the push ("push protection")

Push protection did its job, and nothing went public.

1. **Do not click "allow" or use the bypass link GitHub shows.**
2. Follow Case B to remove the secret from your unpushed commits, then push again.

### Case D: it's already on GitHub (public)

Assume it was copied within minutes: bots scan public repos constantly. Deleting the file does **not** undo that, because it stays in the history.

**Step 1: Kill the secret first. Do this before anything else.**

| What leaked | Where to revoke it |
|---|---|
| Claude API key | console.anthropic.com → API Keys → delete the key, then create a new one |
| Gmail / Google token | myaccount.google.com → Security → Your connections to third-party apps → remove Asteroid Belt |
| GitHub token | github.com → Settings → Applications → revoke; then run `gh auth login` again |
| Any other key | That service's dashboard → revoke / regenerate |

Put the new key in the Keychain (never in a file in the repo).

**Step 2: Check for misuse.**
- Claude API: console.anthropic.com → Usage and Billing. Look for activity you don't recognise.
- Google: myaccount.google.com → Security → Recent security activity.
- GitHub: Settings → Security log.

**Step 3: If it was personal data rather than a key** (you can't "revoke" a statement or a resume):
1. Make the repo private temporarily: GitHub repo → Settings → General → Danger Zone → Change visibility → Private.
2. Continue with Step 4, then contact GitHub Support (support.github.com) and ask them to remove cached views of the commit.
3. If anyone forked the repo, their copy keeps it. Tell GitHub Support about the forks too.

**Step 4: Clean the history.** Ask Claude Code: "remove `<file>` from all git history and force-push." It will use `git filter-repo`. Check afterwards on github.com that the file is gone from the commit history.

**Step 5: Prevent a repeat.** Add a `.gitignore` pattern, re-check with `git status --ignored`, and record what happened in the next handoff note in general terms (never the secret itself).

**Step 6:** If you made the repo private in Step 3, switch it back to public. Then confirm secret scanning and push protection are still on: repo → Settings → Advanced Security.
