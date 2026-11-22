"""Tests for the Vault's side-work routes (/api/vault/...) and the view they build.

Each test gets a temporary data folder with the example settings plus one
invented pay schedule. Touch ID and the Bank of Canada are fakes. All values
are invented.

The worked example (weeks run Saturday to Friday; paid 5-6 days after the
week, landing 3-4 days later), with "today" Wednesday 2026-03-25:
  - Feb 28 - Mar 6: 1 h at $40 USD, unpaid, window Mar 14-16 -> overdue
  - Mar 7 - 13: 2 h + 1.5 h at $40 USD (140.00), paid 139.50 USD on Sun Mar 22
    at Friday's rate 1.3725 -> expected 192.15 CAD, received 191.46, -0.69
  - Mar 14 - 20: 2 h at $40 USD, unpaid, window Mar 28-30 -> waiting
  - no company, 1 h at $30 CAD -> no schedule
  - bonus 20.00 USD on Mon Mar 23 at 1.3800 -> 27.60 CAD
"""

from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from aicity import config
from aicity.db import DbKind
from aicity.fx import RateUnavailable
from aicity.main import create_app
from aicity.mode import OwnerCheck

APP_URL = "http://127.0.0.1:8765"
EXAMPLE_SETTINGS = Path(__file__).resolve().parents[1] / "settings.example.toml"
NOW = datetime(2026, 3, 25, 16, 0, tzinfo=UTC)
SCHEDULE = """
[pay_schedules.platform_a]
name = "Platform A"
period = "weekly"
week_starts = "saturday"
released_days_after_period_end = [5, 6]
arrives_days_after_release = [3, 4]
"""
RATES = {
    date(2026, 3, 20): Decimal("1.3725"),
    date(2026, 3, 23): Decimal("1.3800"),
    date(2026, 3, 24): Decimal("1.3790"),
}


class FakeFetcher:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail
        self.calls = 0

    def __call__(self, start: date, end: date) -> dict[date, Decimal]:
        self.calls += 1
        if self.fail:
            raise RateUnavailable("offline")
        return {d: r for d, r in RATES.items() if start <= d <= end}


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv(config.DATA_DIR_ENV, str(tmp_path))
    (tmp_path / "settings").mkdir()
    text = EXAMPLE_SETTINGS.read_text() + SCHEDULE
    (tmp_path / "settings" / "settings.toml").write_text(text)
    return tmp_path


@pytest.fixture
def fetcher():
    return FakeFetcher()


@pytest.fixture
def app(data_dir, fetcher):
    app = create_app(dev=False, ask=lambda: OwnerCheck.CONFIRMED)
    app.state.clock = lambda: NOW
    app.state.fx_fetcher = fetcher
    app.state.db_kind = DbKind.PERSONAL
    return app


@pytest.fixture
def client(app):
    return TestClient(app, base_url=APP_URL, headers={"origin": APP_URL})


@pytest.fixture
def unlocked(client):
    key = client.post("/api/vault/unlock").json()["key"]
    client.headers["X-Vault-Key"] = key
    return client


def add(client, **body):
    body = {"currency": "USD", **body}
    response = client.post("/api/vault/side-work/entries", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def record(client, **body):
    response = client.post("/api/vault/side-work/payments", json=body)
    assert response.status_code == 201, response.text
    return response.json()


def worked_example(client):
    overdue = add(client, worked_on="2026-03-02", company="platform_a", hours="1", rate="40")
    a = add(client, worked_on="2026-03-10", company="platform_a", hours="2", rate="40")
    b = add(client, worked_on="2026-03-11", company="platform_a", hours="1.5", rate="40")
    add(client, worked_on="2026-03-18", company="platform_a", hours="2", rate="40")
    add(client, worked_on="2026-03-12", hours="1", rate="30", currency="CAD")
    record(
        client,
        kind="pay",
        company="platform_a",
        received_on="2026-03-22",
        amount="139.50",
        currency="USD",
        entry_ids=[a["id"], b["id"]],
    )
    record(
        client,
        kind="bonus",
        company="platform_a",
        received_on="2026-03-23",
        amount="20",
        currency="USD",
    )
    assert client.post("/api/vault/side-work/rates/refresh").json() == {"ok": True}
    return overdue


def view(client):
    response = client.get("/api/vault/side-work")
    assert response.status_code == 200, response.text
    return response.json()


def group_for(v, start):
    return next(g for g in v["groups"] if g["period"] and g["period"][0] == start)


# --- The lock --------------------------------------------------------------------------

LOCKED_CALLS = [
    ("get", "/api/vault/side-work", None),
    ("post", "/api/vault/side-work/entries", {"worked_on": "2026-03-10", "currency": "CAD"}),
    ("patch", "/api/vault/side-work/entries/1", {"role": "x"}),
    ("post", "/api/vault/side-work/entries/1/archive", None),
    (
        "post",
        "/api/vault/side-work/payments",
        {"kind": "bonus", "received_on": "2026-03-10", "amount": "1", "currency": "CAD"},
    ),
    ("post", "/api/vault/side-work/rates/refresh", None),
    ("put", "/api/vault/side-work/rates/2026-03-10", {"rate": "1.37"}),
    ("post", "/api/vault/income/main-job", {"paid_on": "2026-03-20", "net": "2100"}),
    ("patch", "/api/vault/income/main-job/1", {"notes": "x"}),
    ("post", "/api/vault/income/main-job/1/archive", None),
]


@pytest.mark.parametrize(("method", "path", "body"), LOCKED_CALLS)
def test_personal_vault_without_key_is_locked(client, method, path, body):
    response = client.request(method.upper(), path, json=body)
    assert response.status_code == 403
    assert response.json()["detail"] == "Vault is locked."


@pytest.mark.parametrize(("method", "path", "body"), LOCKED_CALLS)
def test_a_wrong_key_is_locked(client, method, path, body):
    client.headers["X-Vault-Key"] = "guess"
    assert client.request(method.upper(), path, json=body).status_code == 403


def test_declined_touch_id_gives_no_key(data_dir):
    app = create_app(dev=False, ask=lambda: OwnerCheck.DECLINED)
    app.state.db_kind = DbKind.PERSONAL
    client = TestClient(app, base_url=APP_URL, headers={"origin": APP_URL})
    assert client.post("/api/vault/unlock").status_code == 403


def test_sample_mode_needs_no_key_and_no_touch_id(data_dir):
    asked = []
    app = create_app(dev=False, ask=lambda: asked.append(1) or OwnerCheck.CONFIRMED)
    app.state.db_kind = DbKind.SAMPLE
    client = TestClient(app, base_url=APP_URL, headers={"origin": APP_URL})
    assert client.get("/api/vault/side-work").status_code == 200
    assert client.post("/api/vault/unlock").json() == {"key": None}
    assert asked == []


def test_sample_mode_never_fetches_rates(data_dir, fetcher):
    app = create_app(dev=False)
    app.state.db_kind = DbKind.SAMPLE
    app.state.fx_fetcher = fetcher
    client = TestClient(app, base_url=APP_URL, headers={"origin": APP_URL})
    assert client.post("/api/vault/side-work/rates/refresh").json() == {"ok": True}
    assert fetcher.calls == 0


# --- The worked example ----------------------------------------------------------------


def test_paid_week_shows_the_difference_at_the_received_days_rate(unlocked):
    worked_example(unlocked)
    g = group_for(view(unlocked), "2026-03-07")
    assert g["status"] == "paid"
    assert g["company_name"] == "Platform A"
    assert g["window"] == ["2026-03-21", "2026-03-23"]
    assert g["expected_cad_cents"] == 19215
    assert g["payment"]["received_cad_cents"] == 19146
    assert g["payment"]["rate"] == "1.3725" and g["payment"]["rate_date"] == "2026-03-20"
    assert g["difference_cad_cents"] == -69
    assert [e["hours"] for e in g["entries"]] == ["2", "1.5"]


def test_unpaid_weeks_are_waiting_or_overdue(unlocked):
    worked_example(unlocked)
    v = view(unlocked)
    assert group_for(v, "2026-02-28")["status"] == "overdue"
    waiting = group_for(v, "2026-03-14")
    assert waiting["status"] == "waiting"
    assert waiting["window"] == ["2026-03-28", "2026-03-30"]
    assert waiting["expected_cad_cents"] == 11032  # 80.00 USD at the latest rate 1.3790
    assert waiting["expected_is_estimate"] is True


def test_entry_without_a_schedule_stands_alone(unlocked):
    worked_example(unlocked)
    g = next(g for g in view(unlocked)["groups"] if g["status"] == "no_schedule")
    assert (g["period"], g["window"], g["expected_cad_cents"]) == (None, None, 3000)


def test_summary(unlocked):
    worked_example(unlocked)
    s = view(unlocked)["summary"]
    assert s["month_received_cad_cents"] == 19146 + 2760  # pay + bonus
    assert s["still_expected_cad_cents"] == 5516 + 11032 + 3000
    assert s["set_aside_cad_cents"] == 4381  # 20% (example settings) of 219.06
    assert (s["set_aside_percent"], s["set_aside_is_placeholder"]) == ("20", True)
    assert s["rates_pending"] is False


def test_bonus_is_listed_apart(unlocked):
    worked_example(unlocked)
    [bonus] = view(unlocked)["bonuses"]
    assert (bonus["received_cad_cents"], bonus["rate"]) == (2760, "1.3800")


def test_schedules_are_offered_by_id_and_name(unlocked):
    assert view(unlocked)["schedules"] == [{"id": "platform_a", "name": "Platform A"}]


# --- Rates pending ---------------------------------------------------------------------


def test_failed_fetch_leaves_rates_pending(app, unlocked, fetcher):
    fetcher.fail = True
    e = add(unlocked, worked_on="2026-03-10", company="platform_a", hours="2", rate="40")
    record(
        unlocked,
        kind="pay",
        received_on="2026-03-22",
        amount="80",
        currency="USD",
        entry_ids=[e["id"]],
    )
    assert unlocked.post("/api/vault/side-work/rates/refresh").json() == {"ok": False}
    v = view(unlocked)
    g = group_for(v, "2026-03-07")
    assert g["payment"]["received_cad_cents"] is None
    assert g["difference_cad_cents"] is None
    assert v["summary"]["rates_pending"] is True


def test_pending_payment_is_filled_once_rates_arrive(unlocked, fetcher):
    fetcher.fail = True
    e = add(unlocked, worked_on="2026-03-10", company="platform_a", hours="2", rate="40")
    record(
        unlocked,
        kind="pay",
        received_on="2026-03-22",
        amount="80",
        currency="USD",
        entry_ids=[e["id"]],
    )
    fetcher.fail = False
    assert unlocked.post("/api/vault/side-work/rates/refresh").json() == {"ok": True}
    g = group_for(view(unlocked), "2026-03-07")
    assert g["payment"]["rate_date"] == "2026-03-20"


def test_manual_rate_fills_a_pending_payment(unlocked, fetcher):
    fetcher.fail = True
    e = add(unlocked, worked_on="2026-03-10", company="platform_a", hours="2", rate="40")
    record(
        unlocked,
        kind="pay",
        received_on="2026-03-22",
        amount="80",
        currency="USD",
        entry_ids=[e["id"]],
    )
    r = unlocked.put("/api/vault/side-work/rates/2026-03-22", json={"rate": "1.37"})
    assert r.status_code == 200, r.text
    g = group_for(view(unlocked), "2026-03-07")
    assert g["payment"]["received_cad_cents"] == 10960


def test_unlikely_manual_rate_is_refused(unlocked):
    r = unlocked.put("/api/vault/side-work/rates/2026-03-22", json={"rate": "13.7"})
    assert r.status_code == 422


# --- Input checks ----------------------------------------------------------------------


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("hours", "0"),
        ("hours", "-2"),
        ("hours", "200"),
        ("hours", "12.345"),
        ("hours", "1:30"),
        ("rate", "-1"),
        ("rate", "40.001"),
        ("rate", "$40"),
        ("worked_on", "2026-02-30"),
        ("worked_on", "1700000000"),
        ("currency", "EUR"),
    ],
)
def test_bad_entry_input_names_the_field(unlocked, field, value):
    body = {"worked_on": "2026-03-10", "currency": "USD", field: value}
    r = unlocked.post("/api/vault/side-work/entries", json=body)
    assert r.status_code == 422
    assert field in r.text


def test_unknown_field_is_refused(unlocked):
    body = {"worked_on": "2026-03-10", "currency": "USD", "project": "secret"}
    assert unlocked.post("/api/vault/side-work/entries", json=body).status_code == 422


def test_edit_and_archive(unlocked):
    e = add(unlocked, worked_on="2026-03-10", hours="2", rate="40")
    r = unlocked.patch(f"/api/vault/side-work/entries/{e['id']}", json={"hours": None})
    assert r.status_code == 200 and r.json()["hundredths"] is None
    r = unlocked.post(f"/api/vault/side-work/entries/{e['id']}/archive")
    assert r.status_code == 200
    assert view(unlocked)["groups"] == []


def test_paid_entry_edit_is_a_conflict(unlocked):
    e = add(unlocked, worked_on="2026-03-10", hours="2", rate="40", currency="CAD")
    record(
        unlocked,
        kind="pay",
        received_on="2026-03-22",
        amount="80",
        currency="CAD",
        entry_ids=[e["id"]],
    )
    r = unlocked.patch(f"/api/vault/side-work/entries/{e['id']}", json={"hours": "3"})
    assert r.status_code == 409


def test_missing_entry_is_not_found(unlocked):
    assert unlocked.patch("/api/vault/side-work/entries/999", json={"role": "x"}).status_code == 404


def test_two_decimal_hours_give_exact_pay(unlocked):
    add(unlocked, worked_on="2026-03-10", hours="1.33", rate="40", currency="CAD")
    [g] = view(unlocked)["groups"]
    assert (g["entries"][0]["hours"], g["expected_cad_cents"]) == ("1.33", 5320)


def test_one_deposit_can_pay_several_sessions_without_a_schedule(unlocked):
    a = add(
        unlocked, worked_on="2026-03-10", company="Some Co", hours="2", rate="30", currency="CAD"
    )
    b = add(
        unlocked, worked_on="2026-03-12", company="Some Co", hours="1", rate="30", currency="CAD"
    )
    add(unlocked, worked_on="2026-03-11", company="Other Co", hours="1", rate="30", currency="CAD")
    groups = view(unlocked)["groups"]
    some = [g for g in groups if g["company"] == "Some Co"]
    assert len(some) == 1 and [e["id"] for e in some[0]["entries"]] == [a["id"], b["id"]]
    assert some[0]["expected_cad_cents"] == 9000
    record(
        unlocked,
        kind="pay",
        company="Some Co",
        received_on="2026-03-20",
        amount="90",
        currency="CAD",
        entry_ids=[a["id"], b["id"]],
    )
    paid = [g for g in view(unlocked)["groups"] if g["company"] == "Some Co"]
    assert len(paid) == 1
    assert (paid[0]["status"], paid[0]["difference_cad_cents"]) == ("paid", 0)
    assert view(unlocked)["summary"]["still_expected_cad_cents"] == 3000  # only Other Co


def test_sample_rates_keep_coming_after_the_day_it_was_made(data_dir, fetcher):
    from datetime import timedelta

    from aicity.sample_data import seed_sample_database

    seed_sample_database(clock=lambda: NOW - timedelta(days=10))
    app = create_app(dev=False)
    app.state.db_kind = DbKind.SAMPLE
    app.state.clock = lambda: NOW
    app.state.fx_fetcher = fetcher
    client = TestClient(app, base_url=APP_URL, headers={"origin": APP_URL})
    record(client, kind="bonus", received_on="2026-03-25", amount="10", currency="USD")
    assert client.post("/api/vault/side-work/rates/refresh").json() == {"ok": True}
    v = view(client)
    assert v["summary"]["rates_pending"] is False
    assert fetcher.calls == 0


# --- Part B: income, edits, badge ------------------------------------------------------


def test_badge_needs_no_key_but_income_does(client):
    assert client.get("/api/vault/badge").status_code == 200
    assert client.get("/api/vault/income").status_code == 403


def test_badge_text_is_counts_only(unlocked):
    add(unlocked, worked_on="2026-03-02", company="platform_a", hours="1", rate="40")
    del unlocked.headers["X-Vault-Key"]
    assert unlocked.get("/api/vault/badge").json() == {"text": "1 overdue"}


def test_income_view_route(unlocked):
    add(unlocked, worked_on="2026-03-12", hours="1", rate="30", currency="CAD")
    v = unlocked.get("/api/vault/income").json()
    assert set(v) >= {"month", "months", "platforms", "set_aside", "main_job_pay"}
    assert len(v["months"]) == 6


def paid_cad(unlocked, amount="80", **extra):
    e = add(unlocked, worked_on="2026-03-10", hours="2", rate="40", currency="CAD")
    return unlocked.post(
        "/api/vault/side-work/payments",
        json={
            "kind": "pay",
            "received_on": "2026-03-22",
            "amount": amount,
            "currency": "CAD",
            "entry_ids": [e["id"]],
            **extra,
        },
    )


def test_record_payment_with_bonus_box_and_notes(unlocked):
    r = paid_cad(unlocked, amount="90", includes_bonus=True, bonus="10", notes="Holiday bonus")
    assert r.status_code == 201, r.text
    [g] = view(unlocked)["groups"]
    assert (g["difference_cad_cents"], g["bonus_cad_cents"], g["payment"]["notes"]) == (
        0,
        1000,
        "Holiday bonus",
    )


@pytest.mark.parametrize(
    "extra",
    [
        {"bonus": "10"},  # no box ticked
        {"includes_bonus": True, "bonus": "100"},  # more than the payment
        {"includes_bonus": True, "bonus": "-1"},
    ],
)
def test_bad_bonus_names_the_field(unlocked, extra):
    r = paid_cad(unlocked, **extra)
    assert r.status_code == 422
    assert "bonus" in r.text.lower()


def test_long_notes_are_refused(unlocked):
    assert paid_cad(unlocked, notes="x" * 501).status_code == 422


def test_edit_payment_notes_and_bonus(unlocked):
    paid_cad(unlocked, amount="90")
    [g] = view(unlocked)["groups"]
    pid = g["payment"]["id"]
    r = unlocked.patch(
        f"/api/vault/side-work/payments/{pid}",
        json={"includes_bonus": True, "bonus": None, "notes": "Paid with bonus"},
    )
    assert r.status_code == 200, r.text
    [g] = view(unlocked)["groups"]
    assert (g["bonus_cad_cents"], g["payment"]["notes"]) == (1000, "Paid with bonus")


def test_record_extra_income_by_hand(unlocked):
    r = unlocked.post(
        "/api/vault/side-work/payments",
        json={
            "kind": "extra",
            "company": "Some Co",
            "received_on": "2026-03-20",
            "amount": "50",
            "currency": "CAD",
            "notes": "One-off",
        },
    )
    assert r.status_code == 201, r.text
    assert [x["notes"] for x in view(unlocked)["extras"]] == ["One-off"]


def add_pay(client, **body):
    return client.post(
        "/api/vault/income/main-job", json={"paid_on": "2026-03-20", "net": "2100"} | body
    )


def test_add_main_job_pay_route(unlocked):
    r = add_pay(unlocked, gross="3000", rrsp="150", match="75", notes="Payday")
    assert r.status_code == 201, r.text
    made = r.json()
    assert (made["day"], made["net_cents"], made["confirmed"]) == ("2026-03-20", 210000, False)
    [row] = unlocked.get("/api/vault/income").json()["main_job_pay"]
    assert row == made
    assert row["deductions_cents"] == 75000


def test_add_main_job_pay_needs_net(unlocked):
    assert (
        unlocked.post("/api/vault/income/main-job", json={"paid_on": "2026-03-20"}).status_code
        == 422
    )
    assert add_pay(unlocked, net="0").status_code == 422


def test_add_main_job_pay_gross_below_net(unlocked):
    r = add_pay(unlocked, gross="1000")
    assert r.status_code == 422
    assert "Gross" in r.json()["detail"]
    assert unlocked.get("/api/vault/income").json()["main_job_pay"] == []


def test_edit_main_job_pay_route_by_pay_id(unlocked):
    pay_id = add_pay(unlocked).json()["id"]
    r = unlocked.patch(
        f"/api/vault/income/main-job/{pay_id}",
        json={"paid_on": "2026-03-19", "net": "2110", "gross": "3000", "notes": "Fixed typo"},
    )
    assert r.status_code == 200, r.text
    assert (r.json()["day"], r.json()["net_cents"], r.json()["notes"]) == (
        "2026-03-19",
        211000,
        "Fixed typo",
    )
    bad = unlocked.patch(f"/api/vault/income/main-job/{pay_id}", json={"gross": "1000"})
    assert bad.status_code == 422  # gross below net


def test_edit_unknown_pay_is_404(unlocked):
    assert unlocked.patch("/api/vault/income/main-job/99", json={}).status_code == 404


def test_edit_confirmed_net_is_refused(app, unlocked):
    from aicity.db import db_path, open_database
    from aicity.income import IncomeStore

    pay_id = add_pay(unlocked).json()["id"]
    conn = open_database(db_path(DbKind.PERSONAL), DbKind.PERSONAL)
    try:
        store = IncomeStore(conn, clock=lambda: NOW)
        imp = store.record_import(
            first_day=date(2026, 3, 19),
            last_day=date(2026, 3, 19),
            kept=1,
            duplicates=0,
            skipped=0,
            spending=0,
        )
        d = store.add_deposit(
            posted_on=date(2026, 3, 19),
            amount_cents=210000,
            kind="main_job",
            source="main_job",
            row_key="a" * 64,
            import_id=imp,
        )
        store.link_main_job_pay(pay_id, d)
    finally:
        conn.close()
    r = unlocked.patch(f"/api/vault/income/main-job/{pay_id}", json={"net": "2000"})
    assert r.status_code == 422
    assert "This pay is confirmed" in r.json()["detail"]
    ok = unlocked.patch(f"/api/vault/income/main-job/{pay_id}", json={"gross": "3000"})
    assert ok.status_code == 200 and ok.json()["confirmed"] is True


def test_archive_typed_pay_route(unlocked):
    pay_id = add_pay(unlocked).json()["id"]
    r = unlocked.post(f"/api/vault/income/main-job/{pay_id}/archive")
    assert r.status_code == 200, r.text
    assert unlocked.get("/api/vault/income").json()["main_job_pay"] == []
    assert unlocked.post("/api/vault/income/main-job/999/archive").status_code == 404


def test_month_main_job_label_sample(data_dir):
    app = create_app(dev=False)
    app.state.db_kind = DbKind.SAMPLE
    client = TestClient(app, base_url=APP_URL, headers={"origin": APP_URL})
    month = client.get("/api/vault/income").json()["month"]
    assert month["main_job_label"] == "Main job"  # never the settings' name, even made-up
    assert month["goal_cents"] == 650000


def test_month_main_job_label_personal(data_dir, unlocked):
    path = data_dir / "settings" / "settings.toml"
    path.write_text(
        path.read_text() + '\n[main_job]\nname = "Day job"\ndeposit_match = "DAY JOB"\n'
    )
    assert unlocked.get("/api/vault/income").json()["month"]["main_job_label"] == "Day job"


# --- A company with no pay timing (just a name) ----------------------------------------------

UNTIMED = """
[pay_schedules.platform_b]
name = "Platform B"
"""


@pytest.fixture
def untimed(data_dir, unlocked):
    path = data_dir / "settings" / "settings.toml"
    path.write_text(path.read_text() + UNTIMED)
    return unlocked


def test_untimed_company_is_in_the_dropdown(untimed):
    ids = [s["id"] for s in view(untimed)["schedules"]]
    assert ids == ["platform_a", "platform_b"]


def test_untimed_company_is_never_overdue(untimed):
    add(untimed, worked_on="2026-01-20", company="platform_b", hours="2", rate="30")
    [g] = [g for g in view(untimed)["groups"] if g["company"] == "platform_b"]
    assert (g["status"], g["period"], g["window"], g["company_name"]) == (
        "no_schedule",
        None,
        None,
        "Platform B",
    )
    assert untimed.get("/api/vault/badge").json()["text"] != "1 overdue"
    assert "overdue" not in (untimed.get("/api/vault/badge").json()["text"] or "")


def test_untimed_company_entries_can_be_paid(untimed):
    e = add(untimed, worked_on="2026-03-02", company="platform_b", hours="2", rate="30")
    record(
        untimed,
        kind="pay",
        company="platform_b",
        received_on="2026-03-20",
        amount="60",
        currency="USD",
        entry_ids=[e["id"]],
    )
    [g] = [g for g in view(untimed)["groups"] if g["company"] == "platform_b"]
    assert (g["status"], g["company_name"]) == ("paid", "Platform B")


def test_untimed_company_is_its_own_income_source(untimed):
    record(
        untimed,
        kind="bonus",
        company="platform_b",
        received_on="2026-03-20",
        amount="50",
        currency="CAD",
    )
    month = untimed.get("/api/vault/income").json()["month"]
    assert {s["key"]: s["name"] for s in month["by_source"]} == {"platform_b": "Platform B"}


# --- Platforms with an active Opportunity Office project --------------------------------

JOBS = """
[jobs]
[[jobs.platforms]]
id = "platform_a"
name = "Platform A"
url = "https://example.com/a"
start_status = "active"

[[jobs.platforms]]
id = "platform_b"
name = "Platform B"
url = "https://example.com/b"
start_status = "active"
"""


def active_project(platform_id: str) -> None:
    from aicity.db import db_path, open_database
    from aicity.jobs_store import JobsStore
    from aicity.settings import load_settings

    conn = open_database(db_path(DbKind.PERSONAL), DbKind.PERSONAL)
    try:
        store = JobsStore(conn, load_settings().jobs, clock=lambda: NOW)
        p = store.add_project(
            platform_id=platform_id,
            title="Reviews",
            pay_cents=None,
            currency=None,
            hours_per_week=None,
        )
        store.set_project_status(p.id, "active")
    finally:
        conn.close()


def test_side_work_offers_platforms_with_an_active_project(data_dir, unlocked):
    settings = data_dir / "settings" / "settings.toml"
    settings.write_text(settings.read_text() + JOBS)
    assert view(unlocked)["active_platforms"] == []
    active_project("platform_b")
    active_project("platform_a")  # same id as a pay schedule: already in the list
    assert view(unlocked)["active_platforms"] == ["Platform B"]


def test_side_work_without_jobs_offers_no_platforms(unlocked):
    assert view(unlocked)["active_platforms"] == []
