# Computer overhaul PR 4: Opportunity Office's apps on the design kit

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Platforms and Log (and the check round shown in the Sunday check-in) use the design kit's look and spacing with no text blocks. Last of four overhaul PRs.

**Architecture:** As in PRs 2 and 3, `frontend/src/desktop/appsOnKit.css` re-themes Opportunity Office's classes (`jobs-card*`, `jobs__chip*`, `jobs__summary`, `jobs-form*`, `jobs-tags*` from `frontend/src/jobs/jobs.css`) inside the computer window only. Buttons and fields already use `.btn`/`.field`, themed in PR 2. Sentence notes become short chips.

**Spec:** `docs/superpowers/specs/2026-11-26-computer-overhaul-design.md` (PR 4 of 4).

## Global Constraints

- Kit tokens only; status tones (good, warn) stay.
- No paragraph text: notes ≤ 5 words; longer guidance in a `title` tooltip.
- No behaviour change; existing tests stay green; no visual layout tests.

## Review Focus

1. Long platform names and project titles truncate inside cards.
2. Empty states ("Nothing logged", "No platforms due") read as one chip.
3. The check round inside the Sunday check-in keeps PR 2's look.
4. The Touch ID gate text stays short.
5. Below-the-pay-floor flag stays visibly warn-toned.

### Task 1: Opportunity Office apps on the kit

**Files:** Modify `frontend/src/desktop/appsOnKit.css`, `frontend/src/jobs/*.tsx` (note copy only)
- [ ] Cards: kit glass, line, radius, spacing, top tint line like the Vault tiles; chips: kit chips with warn/good tones; summary tiles: kit tiles; card names truncate.
- [ ] Notes → chips ("Nothing logged", "Not set up", "No platforms due").
- [ ] Tests, typecheck, prettier, build; live Sample check of Platforms, Log and the check round; commit `Opportunity Office apps on the design kit`.

### Task 2: Finish

- [ ] Fresh checks (frontend, backend unchanged); `graphify update .`; PR. Security checkpoint: not required (no lock, import or AI path changes).
