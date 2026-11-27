# Computer overhaul PR 2: Mission Control's apps on the design kit

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** To-do, Daily plan, Sunday check-in and Grocery list use only the design kit's look and spacing, with no text blocks.

**Architecture:** Mission Control's shared classes (`.btn`, `.field`, `.form-error` in `todo.css`; `.plan__*`, `.checkin__*`, `.grocery__*` in `plan.css`) are re-themed onto kit tokens inside the computer's `.kit` window, so every app inherits one look without rewriting each component. Sentence notes become chips. The Daily plan's day strip becomes glass tiles and its blocks become coloured chips; the check-in's sections become kit sections of chips and tiles. Copy that mentions the old dock points to the left list.

**Spec:** `docs/superpowers/specs/2026-11-26-computer-overhaul-design.md` (PR 2 of 4).

## Global Constraints

- Kit tokens only (`--kit-*`); no new colours outside the blue, grey and black palette except the existing block-kind and warn/good tones.
- No paragraph text: every note is a chip or short label (≤ 5 words).
- No visual layout tests; keep all existing tests green; behaviour unchanged.
- Reduce Motion respected; contrast readable on the glass window.

## Review Focus

1. Empty states (no tasks, no blocks, no events, not checked in) read as one short chip, not a sentence.
2. Long task titles and event names truncate cleanly inside chips and tiles.
3. Copy no longer mentions "the dock".
4. The Undo banner and forms still work inside the new window (fixed positioning stays inside the screen).
5. Sample mode banner still shows.

### Task 1: Re-theme shared Mission Control styles onto the kit

**Files:** Modify `frontend/src/todo/todo.css`, `frontend/src/plan/plan.css`
- [ ] `.btn` = kit glass button look (radius 12, glass fill, blue primary for the main action); `.btn--quiet` = glass; `.btn--danger` = red tone; `.field` = kit field (glass, 1px line, radius 10); `.form-error` = warn chip style.
- [ ] `.plan__tag`, `.checkin__chip`, `.grocery__chip` = kit chip; `.plan__note` = muted chip.
- [ ] Spacing on `.plan`, `.checkin__*` sections uses `--kit-space-*`.
- [ ] `npm test`, `npm run typecheck`, `npm run build`; commit `Mission Control styles on the design kit`.

### Task 2: Notes become chips; dock wording

**Files:** Modify `frontend/src/plan/PlanPanel.tsx`, `frontend/src/plan/CheckinPanel.tsx`, `frontend/src/todo/*.tsx` (only note copy)
- [ ] Replace sentence notes with chips: "Free time", "Nothing due", "No events yet", "All clear", "Not checked in", "Loading…".
- [ ] "open Sunday check-in from the dock" → "Not checked in" chip with a button "Open check-in" that switches apps; "Open the To-do app from the dock…" removed (the To-do app is one click away in the left list).
- [ ] Desktop exposes `openApp(id)` to panels via a small context (`frontend/src/desktop/DesktopContext.tsx`: `useOpenApp(): (id: string) => void`) so a panel button can switch apps; unit-test the pure `appExists(apps, id)` guard.
- [ ] Tests, typecheck, build; commit `Mission Control: short chips instead of notes`.

### Task 3: Daily plan as tiles and chips

**Files:** Modify `frontend/src/plan/PlanPanel.tsx`, `frontend/src/plan/plan.css`
- [ ] Day strip: seven glass tiles (day name, date, block count chip); today highlighted with the accent and blue bar; past days dimmed.
- [ ] Today's blocks: each a row with a coloured kind bar (work blue, gym green, commute grey, event violet, build orange), time chip, name, and Done/Skipped as compact glass toggles.
- [ ] Today list (to-dos, routines, grocery day) as chips grouped under kit section titles.
- [ ] Live check in the browser (Sample); commit `Daily plan: tiles and chips`.

### Task 4: Sunday check-in as sections of chips

**Files:** Modify `frontend/src/plan/CheckinPanel.tsx`, `frontend/src/plan/plan.css`
- [ ] Glance row: week tiles; Events: usual-event chips + added events as chips; Grocery day: day chips; To-dos needing attention: counts as tiles (Overdue / Due this week / Stale) with the titles as chips; Platforms to check (unchanged component, kit look).
- [ ] Finish button as the primary kit button.
- [ ] Live check (Sample); commit `Sunday check-in: sections of chips`.

### Task 5: Finish

- [ ] Fresh checks (frontend tests, typecheck, build; backend unchanged); screenshots of all four apps; `graphify update .`; PR.
