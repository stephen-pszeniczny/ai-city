# Session 3: City Hall to-do screen — design and plan

Status: **draft, waiting for approval.** No code until approved.

## Why

The master to-do list is the heart of City Hall and the first thing meant for daily use
(spec section 1: opened daily, to-do list under control). The backend (`/api/tasks`) is done;
this session gives it a screen.

Real use starts only after session 4 (Personal/Sample switch). Until then the list writes to
the Sample database, so the screen must clearly remind the user not to enter real tasks.

## Goals

- Add, edit, complete, reopen and archive tasks; see stale and overdue tasks at a glance.
- See a task's full history.
- A visible Sample-mode reminder whenever the list is using Sample data.
- Built as a self-contained glass panel that later opens from a robot monitor (session 9).

## Non-goals (this session)

- Reminders actually firing (session 11), the 3D scene (session 9), the mode switch (session 4).
- Drag-to-reorder, bulk actions, search, keyboard shortcuts beyond normal form use.
- A frontend unit-test runner (would be a new install; spec says no visual layout tests).

## Anti-goals (a failure even if it works)

- The user can add a task without seeing the Sample-mode reminder.
- Anything that deletes a task for real (archive only, always undoable).
- A sidebar or full-page app layout that has to be thrown away in session 9 (spec section 7).
- Generic-looking UI that ignores section 7 (black base, royal blue accent, Liquid Glass on
  floating panels, Apple HIG first).

## Approaches considered

1. **Glass panel component on its own route (chosen).** `/todo` renders a `TodoPanel`
   component floating over a dark backdrop; the home placeholder links to it. In session 9 the
   same component opens from a monitor. Least throwaway, fits "no sidebar".
2. Full-page dashboard layout. Faster to lay out, but it's the app layout section 7 rules out
   and would be rebuilt in session 9.
3. Wait and build the to-do screen inside the 3D interior in session 9. Delays daily use by
   weeks and mixes the riskiest work (3D) with the most-used feature.

## Design (builder's calls, for review)

**Mode banner.** New read-only route `GET /api/mode` returns `{"mode": "sample"}` from
`app.state.db_kind`. The panel shows a banner whenever mode is `sample`:
"Sample mode — this list is demo data. Don't add real tasks until Personal mode is built."
A shorter line sits directly under the add field so it's seen at the moment of adding.
Because it comes from the backend, it disappears automatically when session 4 switches to
Personal, and comes back whenever Sample mode is chosen. If the mode can't be read, the banner
shows anyway (fails safe).

**Sketch**

```
┌─ City Hall · To-do ─────────────────────────────────────────┐
│ ⚠ Sample mode — demo data. Don't add real tasks yet.          │
│                                                               │
│ [ Add a task…                         ] [Personal ▾] [ + ]    │
│   ⚠ Sample data only · More options ▸ (notes, date, reminder) │
│                                                               │
│ ( Open 4 )( Done )( Archived )( All )                         │
│                                                               │
│ ○ Send invoice            Side work   Due Dec 1               │
│ ○ Book dentist            Personal    Overdue · Nov 12        │
│ ○ Plan weekly review      City        Stale · 9 days          │
│ ○ Read article            Personal                            │
└───────────────────────────────────────────────────────────────┘
Click a row → the panel slides to a detail view (not a sidebar):
  title, category, goal date, reminder, notes (editable, Save/Cancel),
  Complete / Reopen / Archive, and a history timeline.
Archive shows "Archived · Undo" for a few seconds.
```

**Behaviour**
- Quick add: title + category (+ optional date). Enter adds. "More options" reveals notes and
  reminder. Category labels are plain generic words written in the frontend:
  Work, Side work, Personal, City (IDs `work`, `side_work`, `personal`, `city`).
- Filters: Open (default, with count), Done, Archived, All — a segmented control.
- Row: round checkbox completes (and un-checking reopens), title, category chip in its own
  colour, then one status note: Overdue (goal date before today, red), Due today, Due <date>,
  or Stale · N days (amber, from the backend's `stale` flag and `updated_at`).
- Dates use the browser's own pickers: `<input type="date">` and
  `<input type="datetime-local">`, which produce exactly the formats the backend accepts.
- Errors: the backend's message is shown next to the field or action that failed; nothing is
  silently dropped. Engine down → a clear "engine not reachable" state, no crash.
- Data: React Query; after any change, the list and that task's history are refetched.
- Look: black backdrop with a subtle starfield gradient, one translucent blurred panel,
  royal blue accent, system font (SF on the Mac), 44 px touch targets, visible focus rings,
  respects reduced motion. `frontend-design` skill used as a baseline; section 7 overrides it.

**Files**
- `src/aicity/main.py` — `GET /api/mode` (+ tests; covered by the GET read-only test).
- `frontend/src/api.ts` — typed task and mode calls.
- `frontend/src/todo/` — `TodoPanel.tsx`, `QuickAdd.tsx`, `TaskList.tsx`, `TaskDetail.tsx`,
  `ModeBanner.tsx`, `dates.ts` (overdue / due / stale wording), `todo.css`.
- `frontend/src/App.tsx` — routes: `/` (placeholder with link), `/todo`.

## Tool install (needs a separate yes)

Playwright MCP — install trigger "first Phase 1a UI session" is met. It lets Claude open the
local page in a browser, click through it and take screenshots, for the verification step.
- Source: `github.com/microsoft/playwright-mcp` (npm `@playwright/mcp`, Apache-2.0).
  Version `0.0.84` (31 Oct 2026; newest release at least 14 days old).
- Adds: one MCP server, project scope (`.mcp.json` in the repo), started on demand by Claude
  Code. Runs a local headless browser in an isolated profile (no saved logins or cookies).
  Network: downloads the package from npm, and a browser build on first use; after that it only
  opens pages Claude asks for — limited here to `127.0.0.1`.
- Command:
  `claude mcp add playwright -s project -- npx -y @playwright/mcp@0.0.84 --isolated --headless --allowed-origins "http://127.0.0.1:5173;http://127.0.0.1:8765"`

## Steps (about 2 h, one commit each, scorecard with verification after each)

1. **Mode route** — `GET /api/mode` + tests (route value, follows `db_kind`, read-only). ~15 min
2. **API client** — task and mode types and calls in `api.ts`; type check. ~15 min
3. **Panel shell** — `/todo` route, glass panel, mode banner (incl. fail-safe when mode can't
   be read), engine-down state. ~25 min
4. **Add and list** — quick add with Sample line, filters with counts, rows with
   complete/reopen checkbox, overdue/due/stale notes. ~35 min
5. **Detail view** — edit with Save/Cancel, archive with Undo, reopen, history timeline. ~30 min
6. **Session check** — full verification: fresh re-run of all checks, and a live click-through
   in the browser (Playwright if approved, otherwise manual steps) against a throwaway data
   folder. ~20 min

## Requirements (verification checks each one with evidence)

1. `GET /api/mode` returns the active mode and changes no data.
2. Sample banner visible on the panel whenever mode is sample, and when mode can't be read.
3. Sample line visible directly at the add field.
4. Add a task with title + category; optional date, reminder, notes.
5. Bad input shows the backend's message; nothing saved.
6. Filters Open / Done / Archived / All, with the Open count.
7. Complete and reopen from the row.
8. Overdue, due-today, due-date and stale notes shown correctly.
9. Edit any field from the detail view; Cancel discards.
10. Archive with Undo; archived tasks can be reopened. No real delete anywhere.
11. History timeline shows every change in order.
12. Engine-down state shows clearly without crashing.
13. No sidebar; panel is self-contained for reuse in session 9.
14. Section 7 look: black base, royal blue accent, glass panel, focus rings, reduced motion.
15. Type check and production build pass; backend tests, lint, gitleaks, blocked words clean.

## Left to the builder

Exact colours per category chip, spacing, animation timing, empty-state wording, and how long
Undo stays up (default 6 seconds).
