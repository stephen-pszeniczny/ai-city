# The Vault, part B: statement import, matching, and income cards (design)

> Public file. Generic names only: "main job", `platform_a`, "bank statement". Real names,
> matching words, the goal and the set-aside live in the private settings file.

## Why

Part A made side work trackable, but every payment is typed in by hand and main-job pay isn't
tracked at all. Part B lets Steve import his monthly chequing statement once. The app recognises
main-job pay and side-work deposits, proposes which expected payments they settle, and, once he
confirms, shows real monthly income against his goal: gross with net beside it, by source.

## Goals

- Import a chequing statement CSV (columns: date `YYYY-MM-DD`, transaction, description, amount
  (no sign = money in, minus = money out), balance, currency) from the Vault computer.
- Keep only income from known sources. Matching words are in private settings: one for main-job
  pay, one per side-work platform. Any other incoming row is shown once at review and is either
  added as side income or skipped. Skipped rows and every spending row are never stored.
- Propose matches and let Steve confirm them in one click:
  - a platform deposit → the unpaid pay week it settles,
  - a second, smaller deposit near a week's pay → that week's bonus,
  - a deposit matching a payment already typed in by hand → linked to it, not counted twice.
- Main-job pay: net comes from the deposit. Gross, Steve's RRSP contribution and the employer
  match are typed in, optionally and editable later. Deductions = gross − net − RRSP contribution.
  The employer match is shown separately and never counts toward the goal.
- An **Income** app: this month's progress against the goal (gross, with net beside it), income by
  source stacked against the goal for recent months, side-work hours and effective hourly rate per
  platform, and the tax set-aside balance.
- The Vault's belt badge replaces "Under construction": counts only, shown before Touch ID
  (Steve, 2026-11-18).
- **"Includes a bonus" checkbox** wherever side-work income is entered or reviewed (Steve,
  2026-11-18): the Record payment form and each platform deposit at import review. Ticking it
  shows an optional bonus amount. The bonus part counts as income but not as "extra" against the
  expected pay. With no amount given, everything above the expected pay is treated as the bonus.
- **Notes on every income** (Steve, 2026-11-18): side-work payments (pay, bonus, extra) and
  main-job pay each get an optional note (up to 500 characters), editable later. The form says
  never to add project, client or day-job details.
- Importing an overlapping statement never counts a row twice.

## Non-goals

- Spending, budgets, net worth, credit-card statements, taxes, investments (Phase 3). An
  "E-transfers in" category was considered and left out (Steve, 2026-11-18): occasional income
  e-transfers are added at review like any other unknown deposit.
- PDF statements (CSV only).
- Automatic matching without confirmation. Steve chose "propose, then confirm" for now; automatic
  can come later once the matches have proven right.

## Anti-goals

- Storing a statement file, spending rows, balances, or any description text naming people.
- Counting the same money twice: an overlapping import, or a deposit for a payment already typed in.
- The goal bar including money Steve can't spend (the employer match).
- Personal finance data readable before Touch ID (part A's lock covers every new route).

## Constraints

- Everything from part A still holds: integer cents with half-up rounding in one module, STRICT
  tables with CHECKs, nothing deleted, GET routes never write, tests never touch the network,
  Sample mode never goes online and never shows real values.
- Real names never appear in tracked files (blocked-words hook). Test CSVs in `tests/fixtures/`
  are generated fake data only.
- No new dependencies. Charts are plain SVG in React.

## Approaches considered (Steve picked A)

- **A. Keep only income from known sources (picked).** Recognised rows are stored as deposits;
  unknown incoming rows appear once at review ("add as side income" or "skip"); nothing else is
  kept. The least private data stored.
- **B. Keep every incoming row and sort later.** Nothing is lost, but refunds, transfers and money
  from people would be stored and rarely used.
- **C. Keep every row, including spending.** Ruled out: spending is Phase 3.

## How it works

### Settings (private file)

- `[main_job]` (optional): `name` (shown in the app) and `deposit_match` (text found in the
  description of a pay deposit, case-insensitive).
- `[pay_schedules.<id>]` gains an optional `deposit_match` with the same meaning.

### Data (new migration `005`)

- `deposits`: posted day, amount in CAD cents (more than 0), kind (`main_job` or `side_work`),
  source id (the schedule id, or the company typed in at review), `row_key` (unique), import id,
  created time. The description and balance are not stored.
  - `row_key` is a hash of the row's date, transaction, description, amount, balance and currency.
    Re-importing the same row is recognised and skipped.
- `main_job_pay`: one per main-job deposit. Gross, RRSP contribution and employer match, each
  optional cents. Deductions are worked out, not stored.
- `side_work_payments` gains:
  - `deposit_id` (optional, unique), linking a payment to the deposit that proves it;
  - a payment kind for side income not tied to logged hours (`extra`, used for unknown deposits
    Steve adds as side income);
  - `includes_bonus` (yes/no) and `bonus_cents` (optional);
  - `notes` (optional, up to 500 characters).
- `main_job_pay` also has `notes`.
- `statement_imports`: one row per confirmed import. Date range covered, counts (kept, duplicates,
  skipped, spending rows ignored), created time.

### Reading the CSV

- Header names are matched case-insensitively and all six are required. UTF-8, with or without a
  byte-order mark. Quoted fields are allowed. At most 2 MB and 20,000 rows.
- Amounts are plain numbers with up to 2 decimals and an optional leading minus. Anything else is
  an error naming the line number, never the line's content.
- Only CAD rows are used. Rows in other currencies are counted and reported as skipped.
- Money out (negative amounts) is counted and ignored: never stored, never returned.

### The import flow

1. **Preview** (POST, the file in the body): reads the CSV, fetches any Bank of Canada rates the
   deposit days need (Personal only), and returns the proposals. Nothing is stored. The parsed rows
   wait in memory under a random token for 15 minutes, and are dropped on a mode switch or restart.
2. **Review screen** (the Statements app):
   - main-job deposits, each with optional gross, RRSP and employer-match fields;
   - platform deposits, each with its proposal (a week, a bonus, a link to a typed-in payment, or
     "unmatched": pick a week, call it a bonus, or skip);
   - other incoming rows, each "skip" (the default) or "add as side income" with a company name;
   - a summary line: N already imported, N spending rows ignored, N skipped.
3. **Confirm** (POST, token + decisions): writes everything in one transaction, re-checking that
   every week is still unpaid and every row still new. Returns what was stored.

### Matching rules (one pure function, heavily tested)

- Each platform deposit is checked against unpaid pay weeks of that platform. A week is a candidate
  if the deposit day falls in its arrival window widened by 2 days on each side, and the deposit is
  within 5% of the week's expected pay converted at the Bank of Canada rate for the deposit day.
  - The closest amount wins; a tie goes to the earlier week. Each week is used once.
  - Deposits are taken oldest first.
- A remaining platform deposit within 3 days of a deposit already proposed as a week's pay (or of
  that week's recorded payment) is proposed as that week's bonus.
- A deposit within 3 days and 5% of a payment already typed in by hand for the same platform is
  proposed as a link to that payment: nothing new is counted.
- A week with unknown expected pay (missing hours or rate) can only be proposed when it is the only
  week whose window fits. That proposal is marked "check the amount".
- Everything else is unmatched, and Steve chooses at review.
- Once confirmed, a matched week's payment uses the deposit: received day, CAD amount, the Bank of
  Canada rate for that day (used for the expected side). The difference is shown as in part A, with
  "(after conversion)" when the work was priced in USD. With "includes a bonus" ticked, the
  difference is worked out against expected pay plus the bonus (or shows the part above expected
  as the bonus when no amount is given).

### Income app

- **This month:**
  - Gross = main-job gross + side-work received + extra side income. If a main-job gross is
    missing, its net is used and marked "gross missing".
  - Net beside it = main-job net + side income − the tax set-aside.
  - The employer match is shown under it ("+ $X employer RRSP"), outside the goal.
- **Recent months** (last 6): bars stacked by source (main job, each platform, extra) against a
  goal line.
- **Side work by platform** (last 3 months): hours, received CAD, and effective hourly rate
  (received ÷ hours of the paid weeks).
- **Tax set-aside balance** (moves here from the Side work screen's strip; that strip keeps it too).
- Months follow the deposit or received day in local time.

### Statements app

The upload button, the review screen, and a list of past imports (date range and counts only).

### Sample mode

- An invented main job ("Day job"), and invented deposits for the sample weeks, already imported,
  with some gross and RRSP values filled in.
- A "Try a sample statement" button builds a fake CSV in the browser covering the newest weeks, so
  the import can be demonstrated. It is never stored as a file.

### The Vault's belt badge

Counts only, never amounts, shown without Touch ID (Steve's choice). My call on the rules:
- **"N overdue":** side-work weeks past their latest arrival day.
- **"Statement due":** from the 5th of a month, until a confirmed import covers a day in the month
  before.
- Overdue wins when both apply; nothing shows when neither does.

## Decided at review (Steve, 2026-11-18)

- The badge shows counts before Touch ID (never amounts).
- "Includes a bonus" checkbox and notes on every income (see Goals).

## Left to the builder

- API shapes, component structure, styling within the existing window look.
- Exact chart layout and colours (consistent with the Vault's gold trim).
