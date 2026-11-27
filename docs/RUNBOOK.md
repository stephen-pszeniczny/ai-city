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

**Day and night** → the Belt XP bubble (top right of the belt) has **Day**, **Night** and **Auto**. Auto follows sunrise and sunset at the `[location]` in your settings file, worked out on this Mac. Day or Night stays until you set it back to Auto. The choice is remembered in this browser only.

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

**The belt is in the wrong mode for the time of day** → check Auto is selected in the Belt XP bubble (top right of the belt). Then check `[location]` in your settings file: latitude, longitude (west is negative) and `timezone`, which must be a name from the standard list, like `Europe/London`. No restart needed: reload the page to see the change. If the backend is down, Auto shows day.

**Mac notifications** → when a Personal reminder comes due and you're not looking at the app (window closed, or behind other windows), a Mac notification from "Asteroid Belt" appears; click it to open the app. While the app is in Sample mode it only says "You have a reminder" (never the task), so nothing real shows during a demo. Several at once come as one ("3 reminders came due"). Sample's made-up reminders never make Mac notifications. The shuttle still flies when you next look at the app.

**No Mac notifications** → check `scripts/app.py status` says it's running; check System Settings → Notifications → Asteroid Belt is allowed; if the app was never built, `scripts/app.py update` builds the notifier.

**Notifications only say "Asteroid Belt / Notification", no text** → macOS is hiding previews. System Settings → Notifications → **Show previews**: set it to **Always** (or When Unlocked), and under Asteroid Belt set its own **Show previews** to Always.

**The app doesn't open from the Dock** → run `scripts/app.py status`. Not loaded → `scripts/app.py start`. Loaded but not answering → look at the end of `~/AI-City-Data/logs/app.err.log`; a message about port 8765 means a development backend is still running (Ctrl+C it, then `start`). "The page isn't built yet" → `scripts/app.py update`.

**A reminder didn't show** → check the app is running (reminders are only checked while it is). Check you're in the right mode: Personal reminders never show in Sample. If the reminder time was before the app's very first notification check, it's skipped on purpose. A reminder you just saved fires within 30 seconds; the shuttle waits while you're inside a building and flies when you're back on the belt.

**The Vault asks for Touch ID** → that's expected: once per app session in Personal mode, the first time you open the Vault computer. Reloading the page, restarting the app or switching modes locks it again. Sample mode never asks.

**Adding a side-work platform's pay schedule** → in the settings file, add a block like the commented `[pay_schedules.platform_a]` example in `settings.example.toml`: a short lowercase id, the name to show, the weekday pay weeks start on, and `[earliest, latest]` day counts for release and arrival. No restart needed: close and reopen Side work. The platform then appears in the Log work company list, and its entries get expected pay and a "lands …" window. A week only counts as overdue after the latest day. Don't know its pay timing yet? A block with just `name = "…"` works: the company is in the lists and the Income chart, its entries wait until you record a payment, and nothing is ever "overdue". Add the four timing settings (all of them) later; any of its hours still unpaid then will show as overdue if their pay window has passed. For a company like this, record each payment in Side work when it arrives (tick the hours it covers); a statement deposit then links to that payment at import. Don't add the deposit as a bonus or other income as well as recording the payment, or it counts twice.

**Side work says "rate pending"** → the app couldn't get that day's USD→CAD rate from the Bank of Canada (no internet, or the day's rate isn't published yet: it appears late afternoon). It fills in on its own the next time you open Side work. If it's urgent, type the rate into the box that appears (the Bank of Canada's daily rate for that day). Weekends and holidays use the last business day's rate.

**Monthly statement import (the Vault)** → download last month's chequing statement as **CSV** (not PDF). Open the Vault computer → **Statements** → *Choose statement (CSV)*. Check the review screen: main-job pay (each deposit is proposed as confirming the pay you typed in when it's within 3 days and 1%, or marked "check the amount" when it's within 3 days but further off; otherwise pick the typed-in pay yourself, add it as new pay with the stub details now or later in **Income**, or skip it), each side-work deposit's match (a week, a bonus, "the payment I typed in", or skip), and other money in (skipped unless you tick "add as side income"). Then **Confirm import**. Nothing is stored before that, the file isn't kept, and spending rows are only counted. The Vault's label shows "Statement due" from the 8th until last month is imported, and on the 8th (at the usual reminder time) one reminder flies by and goes to the Mac's notifications. Change the day with `statement_due_day` under `[income]` in the settings file (1 to 28).

**Typing in main-job pay on payday (the Vault)** → open **Income** → *Add pay*: the payday from the stub, the net (the deposit), and the stub details if you have them. It counts toward the goal at once and says **not yet confirmed**. When the month's statement is imported, its deposit confirms it (**✓ confirmed by statement**): the statement's amount is kept if it differs, and the payday stays the date you typed, even though the bank usually posts it a day early. Made a typo? *Edit* fixes the date and net until the statement confirms it, and *Remove* takes away a pay typed in by mistake or twice (it's hidden, never deleted; a confirmed pay can't be removed). If the typed net was more than 1% off, the review still proposes the link but says "check the amount": confirm it rather than adding it as new pay, or it counts twice. Pay typed in for the months before your first imported statement (from the old bank, whose statements were PDF only) was marked **✓ confirmed (checked by hand)** once, when the app was updated after you entered it; pay typed in from now on is never marked that way. Check those older pays (and remove any typo or duplicate) **before** that update: afterwards their date and amount are locked for good. A hand-checked pay never links to a statement deposit, so if a statement covering those months is ever imported, skip its main-job deposits.

**Changing the monthly income goal** → in the settings file under `[goals]`, `monthly_income = "…"`. No restart needed: close and reopen Income.

**Which pay-stub numbers go where** → **Gross** = the stub's *total gross* (after taxable benefits are taken back out). **Your RRSP** = your own contribution line, the one taken off your pay. **Employer contributions (match + flex)** = what the employer puts in for you (its matching plan line plus any flex dollars sent to the plan); it never counts toward the goal. Tax, CPP, EI and the other deductions aren't typed: the app works them out as gross − net − your RRSP. Self-check: gross − the deposit should equal the stub's *total deductions* (which includes your RRSP line), and the app's "tax and deductions" figure is that total minus your RRSP. If it's off by exactly the flex amount, the flex comes out of your pay and belongs in *Your RRSP* instead.

**The import says "already imported"** → those rows were stored by an earlier import (re-downloads and overlapping months are recognised), so they're left out and nothing doubles.

**A deposit says "check the amount"** → the week it matches is missing hours or a rate, so the app couldn't compare amounts; it's proposed only because it's the one week that fits the dates. Confirm it if it's right, or pick another week.

**"No deposits found. Is this the chequing statement?"** → the file had no money coming in (a credit-card statement looks like this). Matching words for pay deposits live in the settings file: `[main_job] deposit_match` and `deposit_match` in each `[pay_schedules.<id>]` block.

**Setting up the Daily plan (Mission Control)** → copy the commented `[plan]` example from `settings.example.toml` into your settings file and put in your own times: one `[[plan.blocks]]` per fixed block (title, kind `work`/`commute`/`gym`/`other`, the days, start and end, 24-hour, no block past midnight). Then open Mission Control's computer → **Daily plan**. Until `[plan]` is there, the app just says to add it. This week and next are saved from these blocks the first time you open them; weeks further ahead wait, and a past week that was never opened stays empty.

**Changing a block in the Daily plan** → pick the day, then *Edit* or *Remove*; *+ Add block* adds an event, side-work or build block. Past days can't be changed. Gym has **Done / Skipped** (tap again to undo) for today and the last 7 days. Overlapping blocks are allowed and marked "overlaps".

**Changed your fixed times in settings?** → it applies from the next week created. For this week, press **Rebuild this week**: from today on, blocks you haven't touched are refreshed from settings. Anything you removed, edited or marked Done/Skipped, and anything you added, stays as it is, and past days aren't touched. Rebuilding twice changes nothing more.

**Sunday check-in (Mission Control)** → open Mission Control's computer → **Sunday check-in**. From Sunday noon it plans next week; on other days it plans this week until this week is checked in. Tap a usual-event chip to add it on its day and time (a chip without a day asks which day; a ✓ chip is already added; a greyed one's day has passed), or *+ Add other event* for anything else, including side-work or build blocks. Pick the grocery day, look over the to-dos needing attention, then **Finish check-in**. Reopening it is safe: it edits the saved week, so nothing gets added twice, and the first finish time is kept. The belt label says **Check-in due** from Sunday noon until next week is checked in, and all week if this week never was (after "N overdue", before "N stale"). One reminder comes at 16:00 on Sunday (shuttle, ticker, Mac notification); if the Mac was asleep, it comes at the next wake. It's cleared when that week is checked in, even mid-week.

**Usual events and check-in times (settings)** → under `[plan]`: `checkin_opens` (default `"12:00"`) and `checkin_reminder` (default `"16:00"`), and one `[[plan.usual_events]]` per chip: `title`, `start`, `end`, and optionally `day` (`"thu"`) and `kind` (`event`, `side_work`, `build` or `other`; default `event`). See the commented example in `settings.example.toml`. No restart needed: reopen the check-in. The check-in day itself is always Sunday.

**Routines (Daily plan)** → repeating checklists like "Evening prep". Add one `[[routines]]` block per routine to the settings file (see the commented example in `settings.example.toml`): `id` (lowercase, e.g. `evening_prep`), `title`, `days`, `shows_from` (when the card lights up), optional `remind_at`, and `items` (1 to 20). They show as cards in the Daily plan's **Today** list on the days they run: tap a chip to tick it. Before `shows_from` the card is faded, but ticking still works. Ticks belong to the day and reset the next day; only today can be ticked. At `remind_at`, if anything is unticked, one reminder comes (shuttle, ticker, Mac notification); it clears once everything is ticked or the day ends. No restart needed: reopen the Daily plan.

**Grocery list (Mission Control)** → open Mission Control's computer → **Grocery list**. Type an item and press Enter. Tap a chip to tick it (tap again to untick); **×** takes one item off the list; **Clear ticked** takes off everything you've bought. Typing a name that's already on the list (any capitals) doesn't add it twice; if it was ticked, it comes back unticked. Nothing is deleted, only hidden. The Daily plan's grocery day shows how many items are left ("🛒 Grocery day · 5 items"), and so does the Sunday check-in. The list reaches the phone in Phase 2.

**Opportunity Office says "isn't set up yet"** → add a `[jobs]` section to the settings file (copy the commented example in `settings.example.toml`): one `[[jobs.platforms]]` per platform with a short lowercase `id`, the `name`, its login page `url` (https) and a `start_status`. No restart needed: reopen the app. Old keys from the first design (`profiles`, `sources`, scan settings) are refused with a message saying to remove them.

**Checking platforms (Opportunity Office)** → each platform is due for a check by its status: active every 3 days, applied / assessment / onboarding weekly, paused monthly, not applied and rejected never (change the days under `[jobs.check_days]`). The belt label shows "N platforms to check". The Sunday check-in lists the ones due: **Open** goes to its login page, **Nothing new** stamps today, **Found something** logs the project (that counts as the check too). Changing a platform's status also starts its check clock again. Opportunity Office asks for Touch ID once per app session, like the Vault.

**Logging a project (Opportunity Office)** → computer → **Log** → *+ Log a project*: the platform, a title in your own words (never copy the platform's description), pay per hour with USD or CAD, hours a week. Tap a status to move it on; **Ended** when it finishes. Below the pay floor shows a warning chip. A project marked **Active** puts its platform in the Vault's Log work company list.

**Flight School monthly log** → on the 1st (change it with `reminder_day` under `[career]`), Mission Control gets the to-do "Log last month for Flight School" with a reminder. In Claude Code, type `/flight-log`: paste or type what you did last month (rough notes are fine; photos of handwritten pages can be shown, they're never saved), then review each proposal (accept, edit or reject). When none are left, the month is done, its progress is saved and the to-do ticks off. Needs a `[career]` section in the settings file (copy the commented example; the defaults are fine). Check where things stand with `.venv/bin/python scripts/flight.py status`.

**Flight School resume (import once, export any time)** → `.venv/bin/python scripts/flight.py resume-import <your resume.docx>` shows how it would be split into sections (headings start a section; tables are skipped) and saves nothing. If it looks right, run the same command with `--confirm`: it's saved once as `v1 <month year>`. Each month with an accepted resume change becomes the next version. `scripts/flight.py resume-export <file.docx>` writes the current resume as a fresh Word file (its own clean layout, not your original's design).

**Belt XP: how it works** → XP is counted from your records each time, never stored. Correcting a record (reopening a to-do, removing a typed pay) corrects the XP; archiving a finished to-do or rejecting a project keeps it. Every 10th level is an upgrade: it plays the next time you open that building (click or Escape skips it), and the level never shows below an upgrade you've seen.

**Belt XP: changing what things earn** → edit `src/aicity/xp_rules.py`: XP per event, daily caps, which buildings earn (only together with the rest of "adding a building" below), and `NORMAL_YEAR_XP` (a year's XP, which is level 100; bigger = slower levels). A change re-prices past work too, so levels can move. Run `.venv/bin/pytest -q` (some tests expect the current numbers), merge, then update the app (section 5).

**Belt XP: toning down the growth** → in `frontend/src/belt/look.ts`, block `growth`: `pieceGlow` (lights) and `pieceMotion` (drones, satellites, moonlets) go from 1 (full) towards 0; `buildInSeconds` and `moment` are the level-up timings. 0.5 for glow and motion passes the tests; 0 fails the ones that expect glow or movement. Asteroid size (`scaleByBuilding`, `maxAsteroidScale`): don't change it on its own. Tests check that the level-up shuttle clears the grown pieces, and a smaller size fails them, so ask Claude Code. Then in `frontend/`: `npm test`, merge, update the app.

**Belt XP: previewing upgrades** → start the development setup (section 2, "While building the page") and open http://127.0.0.1:5173/?growthPreview=10 (any number 0 to 10). The installed app ignores this.

**Belt XP: adding a building** (a job for Claude Code, in the phase that builds it; this is the checklist) →
1. `src/aicity/xp_rules.py`: add its ID to `EARNING_BUILDINGS`, give it a `NORMAL_YEAR_XP` and event values.
2. `src/aicity/xp.py`: write its total function and add it to `_TOTALS`. It counts only what the database records, so an event with no lasting record needs a new migration first.
3. `src/aicity/sample_data.py`: add it to `SAMPLE_XP_HEAD_START` (a test requires the same buildings as step 1) and add made-up records for it. A Sample database already made keeps its old "seen" levels: reset it (section 2, "Fresh Sample data").
4. `frontend/src/belt/built.ts`: add the same ID (a test compares it with step 1). Update the list in `frontend/tests/badges.test.ts`.
5. `frontend/src/belt/growth/ladders.ts`: add it to `GrowthId`, give it a 10-tier ladder in `LADDERS`, and list new pieces in `PIECE_IDS`.
6. A model for each new piece, registered in `growth/pieces.ts`; names in `levelUpNames.ts` (`PIECE_NAMES`, and `LANDMARK_NAMES` for its landmark).
7. Landmark (asteroids): stage 1 is already in `landmarks.ts`. Add stages 2 to 4 in `growth/landmarkStages.ts` (`standLandmark`, `grownLandmark`), and remove the Opportunity Office / Flight School only checks there, in `landmarks.ts` and in `growth/applyGrowth.ts`. **Miss the `applyGrowth.ts` one and the asteroid never grows, with no error.** Those functions treat anything that isn't `jobs` as Flight School, so add a real branch.
8. If it needs them: a size limit in `look.ts` `scaleByBuilding`, and a level-up shuttle spot in `cargoRoute.ts` (`SPOTS`).
9. Tests: add it to the lists in `frontend/tests/ladders.test.ts` and `growthStub.ts` (growth, clearance and shuttle tests loop over these, but some name `jobs` and `career` directly, so check those). In `tests/test_xp.py` and `tests/test_xp_routes.py`, fix tests that expect it to earn nothing. Run both test suites.

**Flight School** already has its XP rules, ladder, piece models and landmark stages: switching it on is steps 1, 3 and 4 plus the tests. It has no made-up Sample records yet.

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
