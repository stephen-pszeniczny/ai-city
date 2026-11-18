# Notifications: shuttle and ticker (in-app): design

Drafted 2026-11-18, builder-checked. Size: a project (full design).

## Intent

The app's main goal is that the owner stops forgetting things. A task's reminder time already
exists but nothing happens when it arrives. This adds the app's notification system (SPEC section
7, "Notifications"; Mission Control is its home): when a reminder comes due, a small rocket flies
across the belt trailing a holographic banner with the task's title, then the reminder joins a
ticker at the bottom of the screen until it's dealt with.

Later buildings (Opportunity Office "leads ready", Post Office important email) and the closed-app
macOS notifications will feed the same stored list, so it's built as a general list now, with
reminders as its first and only source.

## Goals
- A stored list of notifications per database (Personal and Sample separately).
- A reminder coming due creates exactly one notification.
- The shuttle flies once for each notification not yet seen.
- The ticker shows every active notification until it's dismissed or its task is finished.
- Dismiss per notification; opening one takes you to its task.

## Non-goals (this project)
- macOS notifications while the app is closed, launchd, the Dock app. Next step, separately.
- Anything except reminders creating notifications (Steve, 2026-11-18: "just reminders for now").
  Overdue and stale stay on Mission Control's badge only.
- Snooze, repeating reminders, sounds.
- Messages between robots (SPEC: "later, once the backend agents exist").

## Anti-goals
- Banner text that's hard to read (Steve: "make sure the banner font… is large enough to read").
- A shuttle that looks oversized next to the station and asteroids (Steve: proportional, "not
  too big compared to everything else").
- A notification parade after the Mac wakes with many reminders due.
- Showing one database's notifications in the other mode. In Sample mode nothing from Personal
  ever appears on screen.
- Losing a reminder: a reminder that came due while the app or the Mac was off still appears.
- Any task notes, or anything but the title, in a notification.

## Constraints
- SPEC: no data leaves the Mac; generic IDs in code; every "how much" value in
  `frontend/src/belt/look.ts`; reduced motion respected; GET routes never change data (an
  existing test checks every GET route).
- Reminder times are stored as local Mac time to the minute (`reminder_at`, e.g.
  `2026-11-30T09:00`, see `migrations/002_tasks.sql`); "due" means that local time has passed
  on the Mac's clock.
- Database changes go through a new numbered migration in `src/aicity/migrations/`.
- No new dependencies.

## Decisions made with Steve (2026-11-18)
- **Stored list (option B)**, not just live status: notifications are saved, dismissable, and the
  shuttle only flies for unseen ones.
- **Source:** reminders only, for now.
- **Look:** a small white and royal-blue rocket trailing a **holographic cyan ribbon banner**
  (mockup option B), with **a soft engine glow under the rocket** that doesn't overlap the
  banner. Steve may adjust the look later.
- **How it's drawn (approach 1):** the rocket is a real 3D object in the scene; the banner is
  sharp page text pinned to the rocket each frame, the same way building labels follow their
  buildings.
- **Old reminders on first run are skipped:** only reminders due after the feature first runs
  fire. After that nothing is skipped, including reminders that came due while the app or Mac
  was off.
- **Opening a task from the ticker does not dismiss it:** it stays until the task is finished or
  Dismiss is pressed.

## Approaches considered (drawing the shuttle)
1. **3D rocket + page-text banner pinned to it (chosen).** In the world, lit by day and night,
   can pass in front of and behind things; text stays sharp and readable.
2. Flat 2D animation over the canvas. Simplest, but ignores the camera and looks pasted on.
3. All 3D including the banner text. In the world, but text drawn into 3D goes soft and
   shimmers at small sizes, which works against readability.

## Design

### Backend
- **Table `notifications`** (new migration 003): `id`; `kind` (only `'reminder'` for now, a CHECK
  list so later sources add a value); `task_id` (nullable, for future non-task kinds; set for
  reminders); `title` (copied from the task when created, max 200); `due_at` (the reminder's
  local time, same format as `reminder_at`); `created_at`, `seen_at`, `dismissed_at`,
  `cleared_at` (UTC, same format as tasks); unique on `(kind, task_id, due_at)` so one reminder
  time can only ever create one notification. Active means none of dismissed/cleared is set.
- **Start date (Steve: skip old reminders):** the first time the check runs on a database it
  stores `notifications_since` (the local Mac time, to the minute) in the `meta` table. Reminders
  whose `reminder_at` is before that are never turned into notifications. Each database gets its
  own start date. A task saved later with a reminder time already in the past (but after the
  start date) still fires straight away.
- **The reminder check** `check_reminders(conn, now)`: for each open task whose `reminder_at` has
  passed (local Mac time), is on or after `notifications_since`, and has no notification for
  that exact `(task, reminder_at)`, create one. Also clears active reminder notifications whose task is now done or archived, or whose
  task's `reminder_at` no longer matches (edited or removed). Notifications older than 90 days
  that are dismissed or cleared are deleted. It runs in one transaction.
- **When it runs (my call):** a background loop inside the app checks every 30 s, for both
  database files that exist (Personal and Sample), so reminders are caught even when no page
  is open and Personal reminders are caught while Sample mode is on (they show when you switch
  back). It also runs once at app start, which covers reminders due while the app or Mac was off.
  The future closed-app job will call the same function.
- **Routes** (all on the database for the current mode):
  - `GET /api/notifications` → `{mode, items}`: the current mode plus active notifications,
    oldest first: id, kind, task_id, title, due_at, seen (bool). Read only.
  - `POST /api/notifications/{id}/seen` with body `{mode}` → marks it seen (the shuttle has
    flown for it).
  - `POST /api/notifications/{id}/dismiss` with body `{mode}` → dismisses it.
  - 404 unknown id; 409 dismissing one that's already dismissed or cleared; **409 when `mode`
    isn't the current mode** (my call: ids are numbered separately in each database, so a late
    request after a mode switch must never touch the other database's notification). Marking
    seen twice is fine (no error).
- **Sample data:** sample tasks gain one reminder set a few minutes before seeding time, so a
  demo shows a shuttle soon after a reset; existing sample reminders stay. Seeding still refuses
  any database not labelled Sample.

### Frontend
- **Fetching:** the page asks `GET /api/notifications` every 30 s and on becoming visible, and
  again right after any mode switch (the existing cache reset already covers that).
- **The shuttle queue:** unseen notifications fly one at a time, oldest first, 1.5 s apart. If
  more than 3 are unseen at once, the first 3 fly and a fourth shuttle carries "+N more
  reminders"; all are then marked seen. A notification is marked seen when its flight finishes
  (or is skipped), so a reload mid-flight flies it again rather than losing it.
- **Where it flies:** only at belt level and not during a camera flight. Unseen notifications
  wait (in the queue) while inside a building and fly on return to the belt.
- **Mode switch (my call):** switching modes empties the queue and removes a shuttle that's in
  the air at once, without marking it seen, so nothing from one mode stays on screen in the
  other. Seen and dismiss requests carry the mode the item was shown in.
- **The flight:** across the camera's view from one side to the other, above the station and in
  front of the asteroid ring, worked out from the camera's position at launch so it always
  crosses the screen whatever the belt's rotation; about 7 s; gently banked. The rocket is about
  a sixth of the station's length. The engine glow is a soft sprite under and behind the rocket,
  kept clear of the banner.
- **The banner:** the holographic cyan ribbon from the mockup: "REMINDER · <title>", bright text
  at least 17 px, with a faint dark band behind it for contrast, trailing behind the rocket on
  screen. Long titles are cut with an ellipsis at about 48 characters.
- **Reduced motion:** no flight; the banner fades in at the top centre for 5 s, then the item
  joins the ticker.
- **The ticker:** a slim glass strip at the bottom centre, at belt level and inside buildings
  (not on the computer screen, where the to-do app itself is). It shows one notification at a
  time with "1 of N", fading to the next every 6 s (no auto-advance with reduced motion; small
  arrows instead). Each item has **Dismiss** and clicking its text opens Mission Control's
  to-do app with that task selected. Hidden when there are none.
- **Opening a task from the ticker (my call):** plays the normal flights (into Mission Control,
  including the first-visit door greeting, then into its screen), then selects the task in the
  to-do app; with reduced motion it jumps there. If the to-do app has unsaved edits, the existing
  "Discard your unsaved changes?" question comes first. Opening does not dismiss (Steve).
- **Look settings** in `look.ts`: flight seconds, gap between shuttles, rocket size, glow
  strength, banner max characters, ticker seconds per item.

### Tests
- Backend: the reminder check (due, not yet due, exactly due, done/archived task, edited and
  removed reminder, reopened task with the same past reminder doesn't fire twice, one
  notification per reminder time even if the check runs twice, 90-day clean-up, reminders before
  the start date never fire, a past reminder saved after the start date fires), both-databases
  loop, the routes (list, seen, dismiss, 404, 409 including the wrong-mode refusal), the
  migration, GET stays read-only, Sample seeding.
- Frontend (pure rules): the shuttle queue (order, the "+N more" rule, marking seen, emptied on
  mode switch), ticker rotation and wording, title shortening, the flight path crossing the view
  from any camera angle.
- Live: a reminder a minute ahead fires a shuttle; dismiss; finish the task clears it; inside a
  building it waits; reduced motion.

## Left to the builder
The rocket's exact shape and colours within "small white and royal-blue rocket", the exact flight
curve and bank, the ribbon's glow styling within the mockup, the ticker's exact placement relative
to the existing bottom-of-screen elements, and the background loop's mechanism (thread or
async task) as long as it stops cleanly with the app.
