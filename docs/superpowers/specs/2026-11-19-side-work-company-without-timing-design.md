# A side-work company without pay timing (design)

> Public file. Generic names only; the real company name lives in the private settings.
> Agreed with Steve 2026-11-19. A small change.

## Why

Steve is starting with a second side-work company. Its rate varies by job and he doesn't
yet know when or how it pays. He wants it in the side-work company dropdown now, next to
the first platform, to log hours and record what it pays.

## Today

The dropdown lists the `[pay_schedules.<id>]` blocks in the private settings, and every
block must have weekly timing (`period`, `week_starts`, `released_days_after_period_end`,
`arrives_days_after_release`). Timing drives the pay-week groups, "lands …" windows,
"overdue", the badge count and statement matching to weeks. Typing a company under
"Other or blank" works but isn't in the dropdown, and its income shows as "Other side income".

## Change

- A `[pay_schedules.<id>]` block may have **only `name`** (and optionally `deposit_match`).
  The four timing keys become all-or-nothing: all four, or none; some but not all is refused
  with a message naming the missing ones.
- A company without timing:
  - **appears in the dropdown** (log work, record a payment, the bonus/other-income company
    picker) and as **its own source** in the Income chart, totals and "Side work, last 3
    months" card, like the first platform;
  - **no pay-week groups, no "lands …" window, never "overdue"**, not in the badge count:
    its entries are listed one by one, waiting until a payment is recorded for them;
  - at statement import, its deposits are recognised only if `deposit_match` is set; with
    no weeks to match, each is a bonus, a link to a payment typed in by hand, or skipped.
- The first platform, with timing, is unchanged.
- Steve's private settings get one block with the company's name (no timing, no
  `deposit_match` yet). Timing and deposit text are added later, once a couple of payouts
  have arrived.

## Approaches

- **(A, chosen)** Timing optional in a schedule block: one place to name a company, the
  dropdown and the Income source come for free, and timing can be added later without moving
  anything.
- **(B)** A separate `[companies]` list for the dropdown: rejected, two places to keep in step
  and the income wouldn't show as its own source.
- **(C)** Invent placeholder timing: rejected, it would show wrong "overdue" warnings.

## Constraints

Integer cents; Sample mode unchanged (its invented platform keeps timing); the real company
name only in the private settings; no change for data already stored.

## Left to the builder

How a timing-less company's entries are listed in the Side work screen (following how
entries with no company are listed today); test names.
