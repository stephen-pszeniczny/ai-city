# Mission Control: week plan, Sunday check-in, routines and grocery list (design)

> Public file. Example values only. Real work hours, gym time, usual events and routine items live
> in the private settings file; the main job always shows as plain "Work".

## Why

Steve re-decides his week in his head every day and forgets one-off things. His weekdays are
fixed (main-job hours, lunch-time gym, commute on office days) but his evenings and weekends change
week to week. Phase 1b's daily plan turns that into one place: the fixed parts come from settings,
the changing parts are entered once at a Sunday check-in, and the week is then there to look at and
adjust whenever he's at the Mac.

The Mac is usually asleep in the morning (Steve leaves for work soon after waking), so the plan is
built ahead on Sunday, not generated each morning, and the main view is the whole week, not just
today.

## Goals

1. **Week plan.** A saved plan for each week (Monday to Sunday), shown as a week view with today
   highlighted. Fixed blocks come from settings: work, commute (office days) and the lunch-time gym.
2. **Gym Done / Skipped.** The gym block can be marked done or skipped (a mandatory meeting means
   skipped). The result is kept, ready for a gym count later.
3. **Sunday check-in** (replaces the spec's "weekly review"). Opens Sunday from a set time, with one
   reminder (shuttle, ticker, Mac notification). Steve adds the week's events, mostly by tapping
   chips for his usual events, picks the grocery day, and sees what needs attention on the to-do
   list. Finishing it saves the week.
4. **Edits any time on the Mac.** Add, change, move or remove a block in the saved week; changes
   are kept.
5. **Routines.** Short checklists that repeat on set days and times (example: "Evening prep: lunch
   packed, breakfast packed, gym bag ready" on the evenings before work days). Ticks reset each
   day; no streaks. Listed in settings.
6. **Grocery list.** A simple list in Mission Control: add items, tick them off, clear ticked ones.
   The grocery day shows on the week plan with the item count.
7. **One "Today" list** under the plan: today's due and overdue to-dos, today's routines, the
   grocery day if it's today, and (Phase 2) habits, each with its own label.
8. **Sample mode** gets a generated fictional week, events, routines and grocery items.

## Non-goals (now)

- Phone access. The plan is Mac-only. (Phase 2 phone access has the same "Mac asleep" problem;
  noted in the private spec to be solved when Phase 2 starts.)
- Habits (Phase 2). The Today list leaves a labelled place for them.
- Nutrition (calorie tracker, recipe maker): later, in Training Bay, linked to the grocery list.
- Scheduling side work or build blocks automatically. Free time stays open; Steve adds those blocks
  himself at the check-in if he wants them.
- Personal time (relaxing, friends, partner) is not planned.
- AI. Rules only.
- Job feed results in the check-in (added when Opportunity Office exists).

## Anti-goals

- A plan that nags: no auto-filled free time, no reminders beyond the check-in and optional routine
  reminders.
- Any main-job detail beyond the word "Work" and its hours. No meeting names, no project names.
- Real hours, events or routine items in any tracked file, fixture or screenshot.
- Losing an edit: rebuilding a week never wipes blocks Steve added or changed.

## Constraints

- Follows existing patterns: settings parsed strictly with clear messages (`settings.py`), tables
  STRICT with CHECK constraints and "never deleted, archived instead" (`002_tasks.sql`),
  notifications through the existing table and background check (`reminder_loop.py`,
  `statement_reminder.py`), desktop apps listed in `frontend/src/desktop/apps.ts`.
- Times are local Mac time in `location.timezone`. Weeks run Monday to Sunday.
- Mission Control needs no Touch ID (nothing here is on the spec's sensitive list).
- No new dependencies.

## Approaches considered (Steve picked "saved week")

- **Work the plan out fresh on every open.** Settings + events + to-dos combined on the spot; only
  additions stored. Settings changes show at once, nothing to go stale. Dropped once Steve said the
  week should be set up on Sunday and then adjusted: editing a block that's recomputed each time
  needs an override layer, which is the saved week with extra steps.
- **Saved week, created at the Sunday check-in (picked).** The check-in writes the week's blocks;
  edits change saved rows. A settings change applies from the next week, with a "Rebuild this week"
  button for sooner. Matches how Steve thinks about his week.
- **Generate each morning (the spec's original schedule).** Dropped: the Mac is asleep in the
  mornings, so the plan wouldn't exist when needed.

Phone access was considered (keep the Mac awake on its charger, or a synced copy on the phone) and
Steve chose neither: changes are made on the Mac at home.

## How it works

### Settings (private file; example shown)

```toml
[plan]
# The check-in day is always Sunday (PR 2 ruling: a movable day complicated the
# "which week" rule for no use); only its times are settings.
checkin_opens = "12:00"      # check-in available from this time
checkin_reminder = "16:00"   # one reminder at this time if not done

# Fixed blocks, repeated every week. kind: work | commute | gym | other.
# days: mon tue wed thu fri sat sun. Title is what the plan shows.
[[plan.blocks]]
title = "Commute"
kind = "commute"
days = ["mon", "tue"]
start = "07:30"
end = "08:00"

[[plan.blocks]]
title = "Work"
kind = "work"
days = ["mon", "tue", "wed", "thu", "fri"]
start = "09:00"
end = "12:00"

[[plan.blocks]]
title = "Gym"
kind = "gym"
days = ["mon", "tue", "wed", "thu", "fri"]
start = "12:00"
end = "13:00"

# Usual events: one-tap chips at the check-in. day and times are defaults, changeable when added.
[[plan.usual_events]]
title = "Team sport"
day = "thu"          # optional
start = "21:00"
end = "22:00"

# Routines: checklists that show on set days from a set time. remind_at is optional.
[[routines]]
id = "evening_prep"
title = "Evening prep"
days = ["sun", "mon", "tue", "wed", "thu"]
shows_from = "19:00"
remind_at = "21:30"   # optional: one reminder if anything is unticked
items = ["Lunch packed", "Breakfast packed", "Gym bag ready"]
```

Checks: times are 24-hour `HH:MM` and `end > start` (no blocks past midnight); days from the fixed
list; routine ids unique, short codes; 1–20 items per routine; unknown keys refused. The whole
`[plan]` section and `[[routines]]` are optional: without them, the Daily plan app says what to add
and nothing else breaks.

### Data (migration 010)

- `plan_weeks`: one row per week (`week_start` = that Monday, unique), `created_at`,
  `checked_in_at` (null until the check-in is finished), `grocery_day` (a date in that week, or
  null).
- `plan_blocks`: `week_id`, `day` (date), `start`, `end`, `title` (1–100 chars), `kind`
  (`work | commute | gym | event | side_work | build | other`), `source`
  (`settings | added`), `settings_key` (for settings blocks: the block's `kind`, `title` and its order among
  same-named blocks that day, e.g. `work|Work|2` for the afternoon Work; null for added blocks;
  fixed blocks can't move to another day, so the key stays true), `status` (`planned | done | skipped | removed | replaced`; `replaced` only by a rebuild), `edited`
  (true once Steve changes a settings block), `created_at`, `updated_at`. Never deleted: removing sets
  `status = 'removed'`. Done/skipped are allowed only on gym blocks.
- `routine_ticks`: `day`, `routine_id`, `item` (the item's text as listed), `ticked_at`. Unticking
  deletes the tick (ticks aren't history).
- `grocery_items`: `name` (1–100 chars), `status` (`open | ticked | cleared`), `created_at`,
  `ticked_at`, `cleared_at`. Never deleted; "Clear ticked" sets `cleared`.
- `notifications.kind` gains `checkin` and `routine` (table rebuilt as in 007), with "one check-in
  reminder per week" and "one routine reminder per routine per day" enforced by unique indexes.

### Creating a week

- **At the check-in:** the week is created from the settings blocks for each day, then the chosen
  events are added (`source = added`).
- **If Steve skips the check-in:** opening the Daily plan app on any day of a week with no saved
  week creates it from settings automatically, so work and gym still show, with a "Not checked in"
  note and a button to do the check-in now.
- **Rebuild this week** (matching rule is the designer's call): for today and later days only,
  settings blocks that are still `planned` and not `edited` are marked `replaced` and fresh ones are
  added from current settings. A fresh block is skipped when that day already has a row with the
  same `settings_key` that Steve removed, edited, or marked done/skipped, so his choices stick and
  removed blocks never come back. Added blocks and past days are never touched.
- Nothing is created for weeks further ahead than next week.

### The Sunday check-in (Mac)

**Which week** (designer's call): on Sunday from `checkin_opens`, the check-in is for the
week starting the next day. On any other day (or Sunday before `checkin_opens`), it's for the
current week if that week isn't checked in yet; otherwise it shows next week. The week is created
from settings first if it doesn't exist yet.

**It's an editor for the saved week, not a one-time insert** (designer's call): it can be opened
again any time; events already in the week show there with edit and remove, so nothing is added
twice. Finishing the first time sets `checked_in_at`; later finishes just save.

**Reminder and badge** (designer's call): the check-in reminder's moment is the Sunday before the
target week at `checkin_reminder`, so it's made once per week. If the Mac was asleep at `checkin_reminder`, it's made on the
next background check, like other missed reminders. It's cleared once that week is checked in.
"Check-in due" shows on the badge from `checkin_opens` on Sunday, and on any later day while the
current week isn't checked in. It's never stronger than that (no repeat reminders). Check-in and
routine reminders run in Personal mode only, like the statement reminder. Sample mode shows one
pre-made check-in notification so demos still look alive; finishing the check-in clears it
(in Sample mode the finish only clears, never makes). A reminder is cleared once its own week is
checked in, even mid-week.

Steps on one screen, top to bottom:

1. **The week at a glance:** the fixed blocks for next week.
2. **Add events:** usual-event chips (tap to add on its default day and time, or pick another day);
   "Add other event" for a title, day and times. Side-work or build blocks can be added here too.
3. **Grocery day:** pick a day or "none this week". Shows the current list's item count.
4. **To-dos needing attention:** overdue, due this coming week, and stale ones (the existing stale
   rule), each with "open in To-do".
5. **Finish:** saves the week, clears the check-in reminder, and the Mission Control badge's
   "Check-in due" goes away.

### The Daily plan app

```
Week of Nov 23                                [Check-in] [Rebuild this week]
 Mon 23 │ Tue 24 │ Wed 25 (today) │ Thu 26 │ Fri 27 │ Sat 28 │ Sun 29
 ────────────────────────────────────────────────────────────────────
 Wed 25
  9:00  Work
 12:00  Gym                         [Done] [Skipped]
 13:00  Work
 20:00  TV night                    (event)        [edit] [remove]
  🛒 Grocery day: 6 items
 ── Today ────────────────────────────────────────────────
  ☐ Renew licence                   to-do · personal · due today
  ☐ Evening prep: lunch packed      routine (shows from 19:00)
  ◯ Habits                          coming in Phase 2
```

- Week strip across the top; tapping a day shows its blocks. Today selected on open.
- Previous / next week arrows; past weeks are read-only except gym Done/Skipped for the last 7
  days.
- "Add block" on any day; edit or remove any block. Overlapping blocks are allowed and shown in
  time order with a small "overlaps" marker.
- Ticking a to-do here completes it in the To-do list (same task, same history).

### Grocery list app

A new Mission Control desktop app: add an item, tick it, "Clear ticked". Nothing else (no
quantities or aisles yet). Built so a later Training Bay recipe feature can add items.

### Mission Control desktop and badge

- Apps: To-do, Daily plan, Sunday check-in, Grocery list, Projects (later). The old "Weekly review"
  icon becomes "Sunday check-in".
- Badge: adds "Check-in due" from `checkin_opens` on Sunday until the coming week is checked in.

### Reminders

From the existing 30-second background check (only while the Mac is awake; missed ones show next
open, as today):
- **Check-in:** one per week at `checkin_reminder`, cleared when the check-in is finished.
- **Routine:** one per routine per day at `remind_at` (if set), only if an item is unticked;
  cleared once all are ticked or the day ends.

### Sample mode

Generated fictional week with example blocks, a couple of invented events, one routine and a short
grocery list. Uses `settings.example.toml`-style values, never the private settings.

## Build order (one pull request each)

1. Settings `[plan]`, migration 010 (weeks and blocks), week creation and rebuild, Daily plan app
   with gym Done/Skipped and block edits, Today list with to-dos.
2. Sunday check-in screen, usual-event chips, grocery day field, check-in reminder and badge.
3. Routines: settings, ticks, Today list rows, optional reminder.
4. Grocery list app and its count on the plan.

## Left to the builder

- Exact screen layout and styling within the existing desktop window look.
- API route shapes, following `task_routes.py` and `vault_routes.py`.
- How the week strip behaves at narrow widths.
- Test split; money-free, but week creation, rebuild rules, check-in timing and reminder
  once-only rules need tests.

## Private spec changes (after approval; SPEC.md is gitignored)

- Daily plan: real hours replace "core hours 9 to 3"; built at the Sunday check-in, not each
  morning; Mac-only for now.
- Weekly review becomes the Sunday check-in.
- New: routines, grocery list (grocery list added to the Phase 2 phone list).
- Habits: starting list updated; macros and the exercise habit link to later features.
- Nutrition moves from "Ruled out" to a later Training Bay phase, linked to the grocery list;
  calorie and macro numbers stay Mac-only.
- Phase 2 note: phone access needs the Mac awake or another answer; decide when Phase 2 starts.
