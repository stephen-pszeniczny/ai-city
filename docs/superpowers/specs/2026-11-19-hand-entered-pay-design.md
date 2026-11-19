# The Vault: main-job pay typed in by hand, and a monthly statement reminder (design)

> Public file. Generic names only; real names and matching words live in the private settings.
> Approved by Steve 2026-11-19; to be planned and built next session.

## Why

The chequing statement arrives as a CSV only after the month ends, around the 8th, so main-job pay
reaches the Income app weeks late. Side-work pay can already be typed in when it lands and linked
at import. This brings main-job pay into line: type it on payday, and the month-end statement just
**confirms** what was entered. The statement's arrival also gets a reminder.

## Goals

1. **"Add pay" in the Income app.** Main-job pay entered by hand: date (the payday on the stub),
   net, and optionally gross, your RRSP, employer contributions (match + flex) and notes. It counts
   toward the goal at once, marked **"not yet confirmed"**.
2. **Statement confirms it.** At import, a main-job deposit is proposed as a **link** to a
   typed-in pay when it is within **3 days** of the typed date and within **1%** of the typed net.
   The bank posts direct deposits about a day early, so the statement date can come before payday.
   - Confirming marks the pay **"✓ confirmed by statement"**.
   - The **statement's amount wins** if it differs (the review shows both).
   - The pay **keeps the typed date** (Steve, 2026-11-19), so months match pay stubs even when a
     deposit lands the day before a month starts.
   - A main-job deposit with no typed-in pay is added as new pay, as today.
3. **Monthly statement reminder.**
   - **Badge:** "Statement due" now starts on the **8th** (was the 5th) and stays until a confirmed
     import covers a day in the month before.
   - **Reminder:** on that day, at the usual reminder time (`tasks.reminder_time`), if last month
     isn't imported yet: the shuttle banner, the ticker, and a Mac notification ("Time to import
     last month's chequing statement"). Once per month, Personal mode only.
   - **Setting:** the day is `income.statement_due_day` (default 8).

## Non-goals

- Changing side-work linking: hand-typed payments already link within 7 days, which covers
  early deposits.
- Recurring to-do tasks (the reminder is its own, not a task).

## Constraints

Everything from parts A and B holds: integer cents, nothing deleted, GET routes never write, Sample
mode never online and never using private settings, real names never in tracked files.

## How it works (outline for the plan)

- **Data (migration 006):** a `main_job_payments` table (id, paid_on, net_cents, gross, rrsp,
  employer contributions, notes, deposit_id optional and unique, created time).
  - Existing imported main-job pay moves into it: one row per main-job deposit with its stub
    details, `paid_on` = the deposit day, linked to its deposit.
  - The old `main_job_pay` table is left in place unused (nothing is deleted).
- **Import:** matching gains a main-job link rule (±3 days, within 1%). Review shows "Matches the
  pay you typed in (date, amount)" with link / add as new / skip. Confirm links, sets net to the
  deposit amount, and keeps `paid_on`.
- **Income view:**
  - Main-job rows come from `main_job_payments`, each with `confirmed: bool`.
  - Month totals use `paid_on`.
  - The "gross missing" flag is unchanged.
- **Reminder:** the existing reminder loop gains a monthly statement check that creates one
  notification per month (keyed by the month), reusing the shuttle, ticker and Mac notification
  path.
- **Sample mode:** one recent typed-in, unconfirmed pay, so the label shows; the demo statement
  confirms it.

## Left to the builder

API shapes, screen layout, the exact notification wording within the line above.
