# Older main-job pay checked by hand (design)

> Public file. Generic wording only; no amounts, names or real dates of pay.
> Agreed with Steve 2026-11-19. A small, one-time change.

## Why

Steve's main-job pay from before his first imported statement came into an account whose
statements are PDF only. Rather than build a PDF reader for a one-time job, he types those
pays in with *Add pay*, checking each against the old statements himself. No statement
import will ever confirm them, so they would say "not yet confirmed" forever. He wants them
to say confirmed, without a "mark as confirmed" option staying in the app afterwards.

## Change

- **Migration 009** adds `hand_checked_at` (UTC time, optional) to `main_job_payments`, and in
  the same step marks every pay that is **not confirmed by a deposit, not removed, and dated
  before the start of the earliest statement import** as checked by hand (now). If there are
  no imports yet, nothing is marked. It runs once, when the database is upgraded; nothing in
  the app can mark a pay by hand afterwards.
- A hand-checked pay counts as **confirmed** everywhere: it shows
  **"✓ confirmed (checked by hand)"** (statement-confirmed pay keeps "✓ confirmed by
  statement"); its date and net are locked and it can't be removed (stub details stay
  editable); it's not offered as a link at statement review.
- Order for Steve: enter the older pays first, then merge and update. Pays entered after the
  update aren't marked (and can't be, by design).

## Approaches

- **(A, chosen)** One-time marking inside the migration, keyed to the earliest statement
  import: nothing to remove later, no button to misuse, no date literal in public code.
- **(B)** A temporary "Mark checked by hand" button removed by a later change: rejected, two
  rounds of build and update, and a live button in between.

## Constraints

Nothing deleted; integer cents unchanged; Sample unaffected in practice (its only unconfirmed
pay is recent, after its seeded import); no real dates or names in tracked files.

## Calls made by Claude (Steve can change)

The label wording; hand-checked pay locked like statement-confirmed pay.

## Left to the builder

The API field name for "checked by hand"; test names.
