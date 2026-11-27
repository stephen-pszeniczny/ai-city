# Computer overhaul PR 3: the Vault's apps on the design kit, and side-work minutes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Income, Side work and Statements use the design kit's look and spacing with no text blocks, and side-work time is entered as hours and minutes.

**Architecture:** Same approach as PR 2: `frontend/src/desktop/appsOnKit.css` re-themes the Vault's classes (from `frontend/src/vault/vault.css`: `sw-*`, income tiles, chart cards, statement review rows) inside the computer window only. Sentence notes become chips. The side-work form's single Hours box becomes two boxes (hours, then minutes; Tab moves between them) combined by a pure helper into the decimal-hours string the API already accepts. Backend unchanged.

**Spec:** `docs/superpowers/specs/2026-11-26-computer-overhaul-design.md` (PR 3 of 4); SPEC section 8, The Vault (side-work entry).

## Global Constraints

- Kit tokens only (`--kit-*`); existing chart source colours stay.
- No paragraph text: every note is a chip or short label (≤ 5 words); longer guidance moves to a `title` tooltip.
- Money math and API unchanged; hours are still sent as a decimal string with up to 2 decimals (stored as hundredths).
- No visual layout tests; existing tests stay green.

## Review Focus

1. Minutes only (hours blank, 45 min) → 0.75 h; hours only (2, minutes blank) → 2 h; both blank → no hours (allowed, as today).
2. Minutes ≥ 60, negative, or non-integer → a short error chip; the Add button disabled.
3. Rounding: 20 min → "0.33"; 1 h 10 min → "1.17"; total must stay > 0 and ≤ 168 h.
4. Editing an existing entry splits its stored hours back into hours and minutes (1.17 → 1 h 10 min; 0.33 → 0 h 20 min).
5. The Vault lock screen and Touch ID flow still work inside the new window.

### Task 1: Hours and minutes entry

**Files:** Modify `frontend/src/vault/sideWork.ts`, `frontend/src/vault/SideWorkPanel.tsx`; Test `frontend/tests/sideWork.test.ts` (or the existing side-work test file)

**Interfaces:**
- `combineTime(hours: string, minutes: string): { value: string | null; problem: string | null }`: blank + blank → `{value: null, problem: null}`; whole hours ≥ 0, whole minutes 0–59; value = `hours + minutes/60` rounded to 2 decimals, trailing zeros trimmed ("0.75", "2", "1.17", "0.33"); total 0 or > 168 → problem "Time must be over 0 and at most 168 h"; bad input → "Whole hours and 0–59 minutes".
- `splitHours(hours: string | null): { hours: string; minutes: string }`: "1.17" → {"1","10"}; "0.33" → {"0","20"}; null → {"",""}; minutes = round(fraction × 60).
- [ ] Failing tests for every Review Focus 1–4 case; watch them fail.
- [ ] Implement; tests pass.
- [ ] Form: two narrow fields side by side labelled "h" and "min" (`inputMode="numeric"`, aria-labels "Hours" and "Minutes"), Tab order hours → minutes; edit form pre-fills via `splitHours`. Saved entries show "1 h 10 min" (helper `formatTime(hours: string | null): string`, tested: "1.17" → "1 h 10 min", "0.75" → "45 min", "2" → "2 h", null → "time ?").
- [ ] Remove `hoursProblem` if nothing else uses it (no unused code).
- [ ] Tests, typecheck, build; commit `Side work: enter hours and minutes`.

### Task 2: Vault apps on the kit

**Files:** Modify `frontend/src/desktop/appsOnKit.css`, `frontend/src/vault/*.tsx` (note copy only), `frontend/src/vault/vault.css` (remove rules made unused)
- [ ] Income tiles, chart cards, side-work rows, statement review rows: kit glass, line, radius and spacing; buttons and fields already themed by PR 2's rules (check the Vault's own button classes and theme them too).
- [ ] Sentence notes → chips (empty states, "some hours or rates missing" → "partial" chip with a tooltip, statement instructions → short chip + tooltip).
- [ ] Live Sample check of Income, Side work, Statements and the lock screen; commit `Vault apps on the design kit`.

### Task 3: Finish

- [ ] Fresh checks (frontend tests, typecheck, prettier, build; backend `pytest -q` unchanged); screenshots of the three apps; `graphify update .`; PR. Security checkpoint: not required (no lock, import or AI path changes; the Statements import code is untouched).
