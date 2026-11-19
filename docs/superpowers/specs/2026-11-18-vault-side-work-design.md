# The Vault, part A: side-work log and pay check (design)

> Public file. Generic platform IDs only; real platform names, goal and set-aside values live in
> the private settings file.

## Why

Side-work pay arrives weeks after the work, in another currency, with no tax taken off. Today it's
tracked in Steve's head. Part A makes the Vault the one place that knows what was worked, what
should arrive and when, what actually arrived, and how much of it to keep aside for tax.

## Goals

- Log side work: date worked (required), company, hours, rate, currency, role (all optional).
  No project field, ever.
- Work out expected pay (hours × rate) and its CAD value, using Bank of Canada exchange rates the
  app fetches itself.
- Predict when each payment should be paid and land, from per-platform pay schedules in the
  settings file.
- Record what actually arrived and show the difference from expected.
- Show the tax set-aside (placeholder percentage from settings, clearly labelled) and its balance.
- Lock the Vault with Touch ID once per app session in Personal mode; the server enforces it.
- Sample mode gets generated fictional side-work data with fictional platform names.

## Non-goals (later parts)

- Wealthsimple statement import and deposit matching (part B).
- Main-job pay (gross entry and net from statements: part B).
- Goal cards and charts, the Vault's belt badge (part B).
- Spending, net worth, tax estimates, investments (phase 3).

## Anti-goals

- Storing anything about the work itself: task details, project names, client names, people.
- Any personal data sent anywhere. The only network call is a public exchange-rate request that
  carries a currency pair and dates, nothing else.
- Finance data visible in Personal mode before Touch ID (including through the API directly).
- Rounding errors in money: amounts are whole cents, rates exact decimals, rounding in one place.

## Constraints

- Platform names don't appear in tracked files (blocked-words check). Code and tests use generic
  IDs; Sample data uses invented names.
- Settings follow the existing style: text amounts in quotes, unknown keys refused with a clear
  message.
- Database tables refuse bad data themselves (CHECK constraints, STRICT), like `tasks`.
- No new dependencies: `httpx` is already installed.

## Approaches considered (Steve picked A)

- **A. Pay schedules in the private settings file (picked).** One block per platform; adding a
  platform is a settings edit. Matches how goals and reminders work and what the spec asks for.
- **B. Schedule written into code.** Less work now, a code change per platform later.
- **C. A Platforms screen in the app.** Friendliest, but a whole screen for something edited
  rarely.

## How it works

### Settings (private file)

```toml
[pay_schedules.platform_a]               # the key is a generic id; display name below
name = "…"                               # shown in the app
period = "weekly"
week_starts = "saturday"                 # pay weeks run Saturday to Friday
released_days_after_period_end = [5, 6]  # earliest and latest release, in days after the week's last day
arrives_days_after_release = [3, 4]      # earliest and latest arrival, in days after release
```

Pay dates vary, so a schedule gives a window, not a single day. (Placeholder numbers: the
real ones are in the private settings file.)

- `[pay_schedules]` may be empty. A log entry whose company matches no schedule simply gets no
  expected dates.
- The existing `[goals]` and `[income]` sections are read as they are.

### Data (new migration `004_side_work.sql`)

- `side_work_entries`: worked_on (day), company (optional text, or a schedule id), role
  (optional), minutes (optional integer), rate_cents (optional, per hour), currency
  (`CAD`/`USD`), payment_id (optional link), created/updated times. Archived rather than deleted,
  same as tasks.
- `side_work_payments`: received_on (day), amount_cents, currency, the CAD rate used and its date,
  created time, kind (`pay` or `bonus`), company. One pay payment can cover several entries (a
  whole week logged as sessions) or one. A bonus links to no entries and has no expected amount;
  it counts toward income and the tax set-aside but not toward the expected-vs-received
  difference. Platforms send bonuses as separate deposits a day or two after the week's pay.
- `fx_rates`: currency, day, rate (exact decimal text), fetched time. One row per day ever fetched,
  so each rate is downloaded once.

### Money rules (one module, heavily tested)

- Expected pay = minutes × rate_cents ÷ 60, rounded half-up to the cent. Only when both are known.
- CAD value = amount × rate, rounded half-up to the cent. CAD needs no rate.
- Rate choice: a received payment uses the rate on the day it arrived (how CRA treats income).
  Weekends and holidays use the last business day before. Unpaid work uses the latest rate, shown
  as "estimate".
- Difference = received CAD − expected CAD, both at the received day's rate, so currency
  movement doesn't show up as underpayment.
- Tax set-aside = received side income (CAD) × the settings percentage, labelled "placeholder"
  while `tax_set_aside_is_placeholder` is true. Uses the current percentage for all payments, so
  changing it after the accountant visit recalculates everything.

### Pay timing

- Weekly period: the week containing `worked_on`, starting on `week_starts`.
- Release window = the week's last day + the two `released_days_after_period_end` numbers.
  Arrival window = earliest release + earliest arrival delay, to latest release + latest delay.
  Shown as a range, e.g. "lands Nov 8–10".
- An unpaid period is shown as overdue only once the latest arrival day has passed.

### Exchange rates

- Bank of Canada's public Valet API, `FXUSDCAD` series, requested for a date range.
- 10-second timeout. On failure the entry is saved anyway, its CAD value shows "rate pending",
  and the next Vault open retries. Steve can also type a rate by hand as a fallback.
- Tests never touch the network (the fetcher is passed in and faked).

### Touch ID lock (Personal mode)

- `POST /api/vault/unlock` shows the Mac's Touch ID prompt (reusing the mode-switch helper) and
  returns a random key kept only in the page's memory.
- Every Vault API call in Personal mode needs that key; without it the server answers 403.
- The key dies when the page reloads, the app restarts, or the mode changes. So: once per app
  session.
- Sample mode needs no key.

### Screens

- Vault computer gets its first app, **Side work**, in its dock (the other Vault apps stay
  "under construction").
- Top strip: this month received (CAD), still expected (CAD), tax set-aside balance with the
  placeholder label.
- Log form: date (defaults to today), company (pick a schedule or type), hours, rate, currency,
  role.
- List grouped by pay period: expected pay, expected pay and arrival dates, status (waiting,
  overdue, paid), and for paid groups the received amount and the difference.
- "Record payment" on a group: received date, amount, currency; links that group's entries.
- "Record bonus": company, received date, amount, currency.

### Sample mode

- Generated fictional platforms and a few weeks of entries, some paid (one slightly short),
  some waiting, one overdue. Fixed fictional exchange rates stored in `fx_rates`, so Sample works
  offline and the network is never called in Sample.

## Left to the builder

- Exact API shapes, component structure, styling within the existing desktop window look.
- Which screen moment triggers Touch ID (proposed: when the Side work app first opens).
