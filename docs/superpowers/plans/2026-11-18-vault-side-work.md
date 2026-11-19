# The Vault, part A: side-work log and pay check, implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Touch-ID-locked "Side work" app on the Vault computer that logs work, predicts pay and arrival windows, records what arrived (pay and bonuses), shows the difference in CAD, and shows the tax set-aside.

**Architecture:** Pure maths in `side_work_math.py` (money, rates, pay windows), storage in `side_work.py` over a new migration, Bank of Canada rates in `fx.py` behind an injectable fetcher, a server-side `VaultLock`, and routes in `vault_routes.py`. The page gets a `SideWorkPanel` in the Vault's desktop, with its display logic in a pure, tested `sideWork.ts`.

**Tech Stack:** Python 3.13, FastAPI, SQLite (STRICT tables, CHECKs), httpx, pytest; React + TypeScript, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-18-vault-side-work-design.md`

## Global Constraints

- Platform names never appear in tracked files (blocked-words hook). Code, tests and Sample data use generic ids (`platform_a`) and invented names.
- No real amounts, dates of real pay, goal or set-aside values in tracked files. Test dates are invented.
- Money is integer cents; rates are `Decimal` stored as text; all rounding is `ROUND_HALF_UP` to the cent, in `side_work_math.py` only.
- Currencies: `CAD` and `USD` only.
- Tests never touch the network: `fx.py` takes the fetcher as a parameter.
- GET routes never change data (`tests/test_get_routes_read_only.py` covers new routes automatically). Rate fetching happens on a POST.
- Settings errors name the setting, never its value (existing `SettingsError` style).
- Nothing is deleted: entries are archived; payments cannot be deleted in part A.
- Sample mode never calls the network and never asks for Touch ID.
- After code changes: `graphify update .`.

## Review Focus

1. **Weekend or holiday arrival day:** Valet has no rate for that day; the rate from the last business day before is used (look back up to 7 days). Test in Task 4.
2. **Partial entries** (no rate, no hours, no company, or a company with no schedule): the entry is listed, has no expected pay or window, and never counts as overdue. Tests in Tasks 2 and 6.
3. **Server restart or page reload while unlocked:** the old key gets 403, the page returns to the lock screen instead of showing an error. Tests in Tasks 5 and 8.
4. **Paid in a different currency than the work was priced in** (USD work, CAD deposit): both sides are converted at the received day's rate before the difference. Test in Task 2.
5. **Odd hours and rate input** (`"1.5"`, `"0"`, `"-2"`, `"200"`, `"12.345"`): hours must be > 0 and ≤ 168 with up to 2 decimals; rate ≥ 0 with up to 2 decimals; anything else is a 422 naming the field. Tests in Task 6.

---

### Task 1: Pay schedules in settings

**Files:**
- Modify: `src/aicity/settings.py`, `settings.example.toml`
- Test: `tests/test_settings.py`

**Interfaces:**
- Produces: `PaySchedule(id: str, name: str, week_starts: int, release_after: tuple[int, int], arrive_after: tuple[int, int])` (frozen dataclass; `week_starts` is `date.weekday()` style, Monday = 0); `Settings.pay_schedules: dict[str, PaySchedule]` (empty when the section is absent).

- [ ] **Step 1: Write failing tests**

```python
def test_pay_schedule_is_read(example_data):
    s = parse_settings(example_data | {"pay_schedules": {"platform_a": {
        "name": "Platform A", "period": "weekly", "week_starts": "saturday",
        "released_days_after_period_end": [5, 6], "arrives_days_after_release": [3, 4]}}})
    p = s.pay_schedules["platform_a"]
    assert (p.name, p.week_starts, p.release_after, p.arrive_after) == ("Platform A", 5, (5, 6), (3, 4))

def test_pay_schedules_section_is_optional(example_data):
    data = {k: v for k, v in example_data.items() if k != "pay_schedules"}
    assert parse_settings(data).pay_schedules == {}

@pytest.mark.parametrize("bad", [
    {"period": "monthly"}, {"week_starts": "someday"},
    {"released_days_after_period_end": [6, 5]}, {"released_days_after_period_end": [5]},
    {"arrives_days_after_release": [-1, 2]}, {"arrives_days_after_release": [3, 61]},
    {"surprise": 1}])
def test_bad_pay_schedule_is_refused(bad): ...  # SettingsError naming pay_schedules.platform_a
```
(`example_data` is the existing fixture in that file, built from `settings.example.toml`.) Also: ids must match `[a-z][a-z0-9_]{0,30}`.

- [ ] **Step 2:** Run `.venv/bin/pytest tests/test_settings.py -q`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement `_pay_schedules(t: dict) -> dict[str, PaySchedule]`; add `"pay_schedules"` to the allowed top-level keys; day counts are whole numbers 0–60, pairs are `[earliest, latest]` with earliest ≤ latest. Add a commented example block to `settings.example.toml` using `platform_a` and placeholder numbers.
- [ ] **Step 4:** Run `.venv/bin/pytest tests/test_settings.py -q`. Expected: PASS.
- [ ] **Step 5:** Commit `Settings: optional per-platform pay schedules`.

---

### Task 2: Money and pay-window maths

**Files:**
- Create: `src/aicity/side_work_math.py`
- Test: `tests/test_side_work_math.py`

**Interfaces:**
- Consumes: `PaySchedule` (Task 1).
- Produces:
  - `expected_cents(minutes: int | None, rate_cents: int | None) -> int | None`
  - `to_cad_cents(amount_cents: int, currency: str, rate: Decimal | None) -> int | None` (CAD returns as is; USD with no rate returns `None`)
  - `set_aside_cents(received_cad_cents: int, percent: Decimal) -> int`
  - `hours_to_minutes(text: str) -> int` and `money_to_cents(text: str) -> int`, both raising `ValueError` with a plain message
  - `pay_period(worked_on: date, schedule: PaySchedule) -> tuple[date, date]` (first and last day)
  - `arrival_window(period_end: date, schedule: PaySchedule) -> tuple[date, date]`
  - `is_overdue(window: tuple[date, date] | None, paid: bool, today: date) -> bool`
  - `difference_cents(expected_cad: int | None, received_cad: int | None) -> int | None`

- [ ] **Step 1: Write failing tests** (invented dates; a Saturday-start schedule with release `(5, 6)`, arrive `(3, 4)`):

```python
def test_expected_pay_rounds_half_up():
    assert expected_cents(90, 4001) == 6002          # 1.5 h × $40.01 = 60.015
    assert expected_cents(None, 4000) is None and expected_cents(60, None) is None

def test_usd_to_cad_rounds_half_up():
    assert to_cad_cents(1000, "USD", Decimal("1.3725")) == 1373  # 13.725
    assert to_cad_cents(1000, "CAD", None) == 1000
    assert to_cad_cents(1000, "USD", None) is None

def test_set_aside():
    assert set_aside_cents(10001, Decimal("25")) == 2500       # 25.0025 → 25.00

def test_week_runs_saturday_to_friday():
    assert pay_period(date(2026, 3, 11), SCHED) == (date(2026, 3, 7), date(2026, 3, 13))
    assert pay_period(date(2026, 3, 7), SCHED)[0] == date(2026, 3, 7)
    assert pay_period(date(2026, 3, 13), SCHED)[1] == date(2026, 3, 13)

def test_arrival_window():
    assert arrival_window(date(2026, 3, 13), SCHED) == (date(2026, 3, 21), date(2026, 3, 23))

def test_overdue_only_after_latest_day():
    w = (date(2026, 3, 21), date(2026, 3, 23))
    assert not is_overdue(w, False, date(2026, 3, 23))
    assert is_overdue(w, False, date(2026, 3, 24))
    assert not is_overdue(w, True, date(2026, 4, 1))
    assert not is_overdue(None, False, date(2030, 1, 1))

def test_difference_same_rate_both_sides():
    # USD work 10000c, paid as CAD 13700c, rate that day 1.3725 → expected 13725c CAD
    exp = to_cad_cents(10000, "USD", Decimal("1.3725"))
    assert difference_cents(exp, 13700) == -25

@pytest.mark.parametrize("bad", ["0", "-2", "200", "12.345", "", "abc", "1:30"])
def test_bad_hours(bad): ...  # ValueError
def test_hours(): assert hours_to_minutes("1.5") == 90 and hours_to_minutes("0.25") == 15
```

- [ ] **Step 2:** Run `.venv/bin/pytest tests/test_side_work_math.py -q`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement with `Decimal` and `ROUND_HALF_UP`. Hours: up to 2 decimals, > 0, ≤ 168, minutes rounded half-up. Money: same pattern as `settings._money_cents` (non-negative, up to 2 decimals).
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `Vault: money, exchange and pay-window maths`.

---

### Task 3: Tables and the side-work store

**Files:**
- Create: `src/aicity/migrations/004_side_work.sql`, `src/aicity/side_work.py`
- Test: `tests/test_side_work_schema.py`, `tests/test_side_work.py`

**Interfaces:**
- Produces:
  - Tables `side_work_entries`, `side_work_payments`, `fx_rates` as in the spec (STRICT; dates checked with the same `date(x) IS x` trick as `002_tasks.sql`; currency `IN ('CAD','USD')`; cents ≥ 0; `minutes` 1–10080; payment `kind IN ('pay','bonus')`; a trigger refuses DELETE on entries and payments).
  - `Entry`, `Payment` frozen dataclasses mirroring the rows.
  - `SideWorkStore(conn, clock)` with `add_entry(worked_on, company, role, minutes, rate_cents, currency) -> Entry`, `edit_entry(id, **changes) -> Entry` (refused once paid), `archive_entry(id) -> Entry`, `entries(include_archived=False) -> list[Entry]`, `record_payment(kind, company, received_on, amount_cents, currency, entry_ids: list[int], rate: Decimal | None, rate_date: date | None) -> Payment`, `payments() -> list[Payment]`, `set_payment_rate(payment_id, rate, rate_date) -> Payment`.
  - Errors: `SideWorkError` (422), `SideWorkNotFound` (404), `SideWorkConflict` (409).

- [ ] **Step 1: Write failing tests**: the schema refuses `2026-02-30`, `EUR`, negative cents, `kind='other'`, and DELETE; the store round-trips an entry with all optional fields `None`; `record_payment("pay", …, entry_ids=[a, b])` links both; linking an already-paid or archived entry is a 409; a `bonus` with any `entry_ids` is a 422; editing a paid entry is a 409; a new database ends at schema version 4.
- [ ] **Step 2:** Run `.venv/bin/pytest tests/test_side_work_schema.py tests/test_side_work.py -q`. Expected: FAIL.
- [ ] **Step 3:** Write the migration and store, linking entries inside one `with_transaction(..., immediate=True)`.
- [ ] **Step 4:** Run those tests plus `tests/test_db.py`. Expected: PASS.
- [ ] **Step 5:** Commit `Vault: side-work tables and store`.

---

### Task 4: Bank of Canada rates

**Files:**
- Create: `src/aicity/fx.py`
- Test: `tests/test_fx.py`

**Interfaces:**
- Produces:
  - `Fetcher = Callable[[date, date], dict[date, Decimal]]` (USD→CAD by day)
  - `valet_fetcher(start: date, end: date) -> dict[date, Decimal]`: GET `https://www.bankofcanada.ca/valet/observations/FXUSDCAD/json?start_date=…&end_date=…`, 10 s timeout, reads `observations[].d` and `observations[].FXUSDCAD.v`; raises `RateUnavailable` on any network, status or shape problem.
  - `rate_on(conn, day: date) -> tuple[Decimal, date] | None`: cached rate for `day`, or the nearest earlier cached business day within 7 days; never fetches.
  - `refresh_rates(conn, days: set[date], fetch: Fetcher) -> bool`: fetches only what `rate_on` can't answer (one range call from min(days) − 7 to max(days)), stores rows, returns `False` instead of raising on failure.
  - `save_manual_rate(conn, day: date, rate: Decimal) -> None` (rate between 0.5 and 3; marked `source='manual'`).

- [ ] **Step 1: Write failing tests** with a fake fetcher: Saturday and a Monday holiday use the previous Friday's rate; a cached day makes no fetch call (fake counts calls); a failing fetcher returns `False` and stores nothing; nothing within 7 days gives `None`; a parsed sample Valet JSON body (fixture written in the test, invented numbers) gives exact `Decimal`s; a manual rate of `"0"` or `"10"` is refused.
- [ ] **Step 2:** Run `.venv/bin/pytest tests/test_fx.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement. `valet_fetcher` uses `httpx.get` with no headers beyond httpx defaults (nothing personal is sent).
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `Vault: Bank of Canada exchange rates with a local cache`.

---

### Task 5: Vault lock

**Files:**
- Create: `src/aicity/vault_lock.py`
- Modify: `src/aicity/main.py` (create `app.state.vault_lock`; `change_mode` calls `forget()` after any switch)
- Test: `tests/test_vault_lock.py`

**Interfaces:**
- Consumes: `OwnerCheck`, `ask_owner` from `mode.py`.
- Produces: `VaultLock(ask)` with `unlock() -> str` (asks Touch ID, returns a `secrets.token_urlsafe(32)` key; raises the existing `SwitchRefused`, `SwitchUnavailable` or `SwitchBusy` types so the existing handlers answer 403, 503 and 409), `allows(key: str | None) -> bool` (constant-time compare), `forget() -> None`. Only the newest key is valid.

- [ ] **Step 1: Write failing tests**: a confirmed ask gives a key that `allows`; a refused ask raises and leaves the lock shut; a second `unlock()` while the first waits raises `SwitchBusy`; `forget()` shuts it; a new `VaultLock` (restart) refuses the old key; switching mode through `PUT /api/mode` shuts it.
- [ ] **Step 2:** Run `.venv/bin/pytest tests/test_vault_lock.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests plus `tests/test_mode_route.py`. Expected: PASS.
- [ ] **Step 5:** Commit `Vault: Touch ID lock once per app session`.

---

### Task 6: Vault routes and the side-work view

**Files:**
- Create: `src/aicity/vault_routes.py`
- Modify: `src/aicity/side_work.py` (add the view builder), `src/aicity/main.py` (register), `src/aicity/sample_data.py` (add the constant `SAMPLE_PAY_SCHEDULES = {"sample_a": PaySchedule("sample_a", "Nimbus Labs", 5, (5, 6), (3, 4))}`; Task 7 seeds data that uses it)
- Test: `tests/test_vault_routes.py`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces, all under `/api/vault`; in Personal mode every route except `unlock` needs header `X-Vault-Key` (403 `"Vault is locked."` otherwise):
  - `POST /unlock` → `{"key": str}`
  - `GET /side-work` → `{"summary": {"month_received_cad_cents", "still_expected_cad_cents", "set_aside_cad_cents", "set_aside_percent": str, "set_aside_is_placeholder": bool, "rates_pending": bool}, "schedules": [{"id", "name"}], "groups": [Group]}`; a group is `{"company", "schedule_id" | null, "period": [start, end] | null, "window": [earliest, latest] | null, "status": "waiting" | "overdue" | "paid" | "no_schedule", "entries": [...], "expected_cad_cents" | null, "expected_is_estimate": bool, "payment": {...} | null, "difference_cad_cents" | null}`, plus `"bonuses": [...]`.
  - `POST /side-work/entries` with body `{worked_on, company?, role?, hours?: str, rate?: str, currency}` → entry
  - `PATCH /side-work/entries/{id}`, `POST /side-work/entries/{id}/archive`
  - `POST /side-work/payments` with body `{kind, company?, received_on, amount: str, currency, entry_ids: [int]}`
  - `POST /side-work/rates/refresh` → `{"ok": bool}` (Personal only; in Sample it returns `{"ok": true}` without fetching)
  - `PUT /side-work/rates/{day}` with body `{rate: str}` (manual fallback)
  - `side_work_view(store, conn, schedules: dict[str, PaySchedule], income: IncomeSettings, today: date) -> dict` in `side_work.py` builds the GET body. The route passes `settings.pay_schedules` in Personal mode and `sample_data.SAMPLE_PAY_SCHEDULES` in Sample mode. Grouping: entries whose company matches a schedule id are grouped by pay period; others form one `no_schedule` group per entry. "This month" means the local calendar month of `received_on`.

- [ ] **Step 1: Write failing tests** using `TestClient(create_app(ask=fake))` in Personal mode with a temp data dir (follow `tests/test_task_routes.py` setup): no key gives 403 on every route; with a key, add two entries in one week plus one with no company, record a USD pay covering the week and a bonus, and check groups, `paid` status, difference at the received-day rate, summary month total including the bonus, and set-aside using the settings percent; an unpaid week past its window is `overdue`; no rate cached gives `rates_pending: true` and `expected_cad_cents: null` for USD; Review Focus 5 inputs answer 422 naming `hours` or `rate`; Sample mode needs no key.
- [ ] **Step 2:** Run `.venv/bin/pytest tests/test_vault_routes.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement, following `task_routes.py` (pydantic bodies, `_store` context manager, exception handlers). Fetching is injected through `app.state.fx_fetcher` (defaults to `valet_fetcher`; tests set a fake).
- [ ] **Step 4:** Run the new tests plus `tests/test_get_routes_read_only.py`. Expected: PASS.
- [ ] **Step 5:** Commit `Vault: side-work routes behind the lock`.

---

### Task 7: Sample data

**Files:**
- Modify: `src/aicity/sample_data.py`
- Test: `tests/test_sample_data.py`

**Interfaces:**
- Consumes: `SideWorkStore`, `fx_rates` table.
- Produces: seeding adds invented platforms ("Nimbus Labs" with a schedule id `sample_a` read from Sample-only defaults, and "Quill & Co" with no schedule), about six weeks of entries, paid weeks (one paid slightly short), one waiting, one overdue, two bonuses, and fixed invented USD→CAD rates for every day used. Entries for "Nimbus Labs" use company `sample_a` so they group under `SAMPLE_PAY_SCHEDULES` (added in Task 6).

- [ ] **Step 1: Write failing tests**: after seeding, the view has at least one each of `paid`, `waiting`, `overdue` and `no_schedule`; one paid group has a negative difference; `rates_pending` is false; Sample seeding never calls a fetcher (pass one that fails the test if called).
- [ ] **Step 2:** Run `.venv/bin/pytest tests/test_sample_data.py -q`. Expected: FAIL.
- [ ] **Step 3:** Implement with dates relative to `now`, like the sample tasks.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `Sample mode: fictional side-work history`.

---

### Task 8: The Side work app on the Vault computer

**Files:**
- Create: `frontend/src/vault/sideWork.ts`, `frontend/src/vault/SideWorkPanel.tsx`, `frontend/src/vault/VaultLockScreen.tsx`, `frontend/src/vault/vault.css`
- Modify: `frontend/src/api.ts` (vault calls; `request` gains an optional headers argument; the key lives in a module variable, never in storage), `frontend/src/desktop/apps.ts` (finance apps: Side work ready; Income, Statements, Goals later), `frontend/src/desktop/Desktop.tsx` (render the panel; icon)
- Test: `frontend/tests/sideWork.test.ts`, `frontend/tests/apps.test.ts`

**Interfaces:**
- Consumes: Task 6 routes.
- Produces: `formatCad(cents: number) -> string` ("$1,234.50"), `formatWindow([a, b]) -> string` ("lands Mar 21–23", across months "lands Mar 30 – Apr 1", same day "lands Mar 21"), `statusLabel(status) -> string`, `parseHoursInput(text) -> string | null` for instant form feedback.

- [ ] **Step 1: Write failing tests** for those helpers and that `appsFor("finance")` lists Side work as ready.
- [ ] **Step 2:** Run `cd frontend && npm test`. Expected: FAIL.
- [ ] **Step 3:** Implement. In Personal mode with no key, the panel shows `VaultLockScreen` ("Unlock with Touch ID" button); any 403 clears the key and returns there. The summary strip shows the placeholder label next to the set-aside while `set_aside_is_placeholder`. On open the panel POSTs `rates/refresh`, then GETs the view. A "rate pending" chip offers the manual rate field.
- [ ] **Step 4:** Run `npm test && npm run typecheck && npm run build`. Expected: all pass.
- [ ] **Step 5:** Commit `Vault: Side work app with Touch ID unlock`.

---

### Task 9: Live check and wrap-up

**Files:**
- Modify: `docs/RUNBOOK.md` (adding a pay schedule; what "rate pending" means), private `~/AI-City-Data/settings/settings.toml` (the real schedule block, never committed)

- [ ] **Step 1:** Add the real pay schedule to the private settings file (Steve's numbers from SPEC.md).
- [ ] **Step 2:** `scripts/app.py stop`, start the dev servers, and in Sample mode: open the Vault computer, check all four statuses, add an entry, record a payment, record a bonus. Then switch to Personal: Touch ID appears once, a reload asks again, and one real rate refresh succeeds against Bank of Canada.
- [ ] **Step 3:** Full fresh check: clear caches, `.venv/bin/pytest -q`, `ruff check`, `ruff format --check`, `npm test`, `npm run typecheck`, `npm run build`, gitleaks over full history, blocked words over every tracked file, `graphify update .`.
- [ ] **Step 4:** Commit `Runbook: pay schedules and exchange rates`, push the branch, open the PR, then after merge run `scripts/app.py update`.
