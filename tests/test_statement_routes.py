"""Tests for statement preview and confirm (/api/vault/statements/...).

Temporary data folder, example settings plus an invented main job and platform.
Touch ID and the Bank of Canada are fakes. Every CSV is written here, invented.

The worked example ("today" Wednesday 2026-03-25; weeks run Saturday to Friday):
  - platform_a logged 2 h + 1.5 h at US$40 in the week Mar 7-13 (US$140 expected),
    landing window Mar 21-23; Friday Mar 20's rate 1.3725 -> CA$192.15 expected
  - statement: refund 12.00 (other income), grocery -45.10 (spending), main-job pay
    2100.00, platform pay 191.00 on Sun Mar 22 (0.6% under), platform bonus 25.00
    on Mar 23, and one USD row
"""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from aicity import config
from aicity.db import DbKind, db_path, open_database
from aicity.income import IncomeStore
from aicity.main import create_app
from aicity.mode import OwnerCheck

APP_URL = "http://127.0.0.1:8765"
EXAMPLE_SETTINGS = Path(__file__).resolve().parents[1] / "settings.example.toml"
NOW = datetime(2026, 3, 25, 16, 0, tzinfo=UTC)
EXTRA_SETTINGS = """
[pay_schedules.platform_a]
name = "Platform A"
period = "weekly"
week_starts = "saturday"
released_days_after_period_end = [5, 6]
arrives_days_after_release = [3, 4]
deposit_match = "NIMBUS LABS"

[main_job]
name = "Day job"
deposit_match = "DAY JOB PAY"
"""
RATES = {date(2026, 3, 20): Decimal("1.3725"), date(2026, 3, 23): Decimal("1.3800")}
HEADER = "date,transaction,description,amount,balance,currency"


def statement(*rows: str) -> bytes:
    return "\n".join((HEADER, *rows)).encode()


STATEMENT = statement(
    "2026-03-15,Deposit,REFUND SHOP,12.00,1012.00,CAD",
    "2026-03-16,Purchase,GROCER,-45.10,966.90,CAD",
    "2026-03-20,Deposit,DAY JOB PAY,2100.00,3066.90,CAD",
    "2026-03-22,Deposit,NIMBUS LABS PAYOUT,191.00,3257.90,CAD",
    "2026-03-23,Deposit,NIMBUS LABS PAYOUT,25.00,3282.90,CAD",
    "2026-03-23,Deposit,NIMBUS LABS,10.00,10.00,USD",
)


class FakeFetcher:
    def __call__(self, start, end):
        return {d: r for d, r in RATES.items() if start <= d <= end}


class Clock:
    def __init__(self):
        self.now = NOW

    def __call__(self):
        return self.now


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv(config.DATA_DIR_ENV, str(tmp_path))
    (tmp_path / "settings").mkdir()
    (tmp_path / "settings" / "settings.toml").write_text(
        EXAMPLE_SETTINGS.read_text() + EXTRA_SETTINGS
    )
    return tmp_path


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def app(data_dir, clock):
    app = create_app(dev=False, ask=lambda: OwnerCheck.CONFIRMED)
    app.state.clock = clock
    app.state.fx_fetcher = FakeFetcher()
    app.state.db_kind = DbKind.PERSONAL
    return app


@pytest.fixture
def client(app):
    c = TestClient(app, base_url=APP_URL, headers={"origin": APP_URL})
    c.headers["X-Vault-Key"] = c.post("/api/vault/unlock").json()["key"]
    for day in ("2026-03-10", "2026-03-11"):
        hours = "2" if day.endswith("10") else "1.5"
        r = c.post(
            "/api/vault/side-work/entries",
            json={
                "worked_on": day,
                "company": "platform_a",
                "hours": hours,
                "rate": "40",
                "currency": "USD",
            },
        )
        assert r.status_code == 201, r.text
    return c


def preview(client, body=STATEMENT):
    return client.post(
        "/api/vault/statements/preview", content=body, headers={"Content-Type": "text/csv"}
    )


def decisions(p, refund="add"):
    platform = []
    for row in p["platform"]:
        prop = row["proposal"]
        platform.append(
            {
                "ref": row["ref"],
                "action": prop["kind"],
                "week_start": prop["week_start"],
                "payment_id": prop["payment_id"],
            }
        )
    return {
        "token": p["token"],
        "main_job": [
            {
                "ref": r["ref"],
                "gross": "3000",
                "rrsp": "150",
                "match": "75",
                "notes": "Stub checked",
            }
            for r in p["main_job"]
        ],
        "platform": platform,
        "other_income": [
            {"ref": r["ref"], "action": refund, "company": "Some Co"} for r in p["other_income"]
        ],
    }


def confirm(client, body):
    return client.post("/api/vault/statements/confirm", json=body)


def count(app, table):
    conn = open_database(db_path(DbKind.PERSONAL), DbKind.PERSONAL)
    try:
        return conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
    finally:
        conn.close()


# --- Preview -----------------------------------------------------------------------------


def test_preview_proposes_and_stores_nothing(app, client):
    r = preview(client)
    assert r.status_code == 200, r.text
    p = r.json()
    assert [row["proposal"]["kind"] for row in p["platform"]] == ["week", "bonus"]
    assert p["platform"][0]["proposal"]["week_start"] == "2026-03-07"
    assert [x["amount_cents"] for x in p["main_job"]] == [210000]
    assert [x["amount_cents"] for x in p["other_income"]] == [1200]
    assert (p["spending"], p["other_currency"], p["already_imported"]) == (1, 1, 0)
    assert (p["first_day"], p["last_day"]) == ("2026-03-15", "2026-03-23")
    for word in ("NIMBUS", "REFUND", "GROCER", "DAY JOB", "4510", "3282"):
        assert word not in r.text
    assert count(app, "deposits") == 0


def test_a_statement_with_no_money_in_is_refused(client):
    body = f"{HEADER}\n2026-03-16,Purchase,GROCER,-45.10,966.90,CAD\n".encode()
    r = preview(client, body)
    assert r.status_code == 422
    assert "No deposits found" in r.json()["detail"]


def test_a_broken_file_names_the_line(client):
    r = preview(client, f"{HEADER}\n2026-03-16,Deposit,X,$5,1,CAD\n".encode())
    assert r.status_code == 422 and "line 2" in r.json()["detail"]


def test_a_huge_file_is_refused(client):
    assert preview(client, b"x" * (2 * 1024 * 1024 + 1)).status_code == 413


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", "/api/vault/statements/preview"),
        ("post", "/api/vault/statements/confirm"),
        ("get", "/api/vault/statements"),
    ],
)
def test_statements_are_locked_without_the_key(client, method, path):
    del client.headers["X-Vault-Key"]
    assert client.request(method.upper(), path, content=b"{}").status_code == 403


# --- Confirm -----------------------------------------------------------------------------


def test_confirm_stores_only_what_was_decided(app, client):
    p = preview(client).json()
    r = confirm(client, decisions(p))
    assert r.status_code == 200, r.text
    assert r.json() == {"import_id": 1, "kept": 4, "duplicates": 0, "skipped": 0}
    side = client.get("/api/vault/side-work").json()
    [week] = [g for g in side["groups"] if g["period"] and g["period"][0] == "2026-03-07"]
    assert week["status"] == "paid"
    assert (week["payment"]["amount_cents"], week["payment"]["currency"]) == (19100, "CAD")
    assert week["payment"]["deposit_id"] is not None
    assert week["difference_cad_cents"] == 19100 - 19215
    assert [b["amount_cents"] for b in side["bonuses"]] == [2500]
    assert [x["company"] for x in side["extras"]] == ["Some Co"]
    imports = client.get("/api/vault/statements").json()
    assert imports[0]["kept"] == 4 and imports[0]["spending"] == 1


def test_confirm_new_main_job_deposit_with_stub_details(app, client):
    p = preview(client).json()
    confirm(client, decisions(p))
    [pay] = pays()
    assert (pay.paid_on, pay.net_cents, pay.confirmed) == (date(2026, 3, 20), 210000, True)
    assert (pay.gross_cents, pay.rrsp_cents, pay.match_cents, pay.notes) == (
        300000,
        15000,
        7500,
        "Stub checked",
    )


# --- Main-job pay typed in by hand, confirmed by the statement ----------------------------


def with_income(work):
    conn = open_database(db_path(DbKind.PERSONAL), DbKind.PERSONAL)
    try:
        return work(IncomeStore(conn, clock=lambda: NOW))
    finally:
        conn.close()


def type_pay(day, net):
    return with_income(
        lambda s: s.add_main_job_pay(
            paid_on=day,
            net_cents=net,
            gross_cents=None,
            rrsp_cents=None,
            match_cents=None,
            notes=None,
        )
    ).id


def pays():
    return with_income(lambda s: s.main_job_pay())


EARLY = statement("2026-03-19,Deposit,DAY JOB PAY,2100.00,3066.90,CAD")


def main_choices(p, **choice):
    return {
        "token": p["token"],
        "main_job": [{"ref": r["ref"], **choice} for r in p["main_job"]],
        "platform": [],
        "other_income": [],
    }


def test_preview_proposes_link_to_typed_pay(client):
    pay_id = type_pay(date(2026, 3, 20), 210000)
    p = preview(client, EARLY).json()
    assert p["main_job"][0]["proposal"] == {
        "kind": "link",
        "pay_id": pay_id,
        "pay": {"paid_on": "2026-03-20", "net_cents": 210000},
        "check_amount": False,
    }
    assert p["typed_pay"] == [{"id": pay_id, "paid_on": "2026-03-20", "net_cents": 210000}]


def test_preview_with_no_typed_pay_proposes_new(client):
    p = preview(client, EARLY).json()
    assert p["main_job"][0]["proposal"] == {
        "kind": "new",
        "pay_id": None,
        "pay": None,
        "check_amount": False,
    }
    assert p["typed_pay"] == []


def test_confirm_link_confirms_typed_pay(client):
    pay_id = type_pay(date(2026, 3, 20), 209900)  # typed 1.00 less: the statement wins
    p = preview(client, EARLY).json()
    r = confirm(client, main_choices(p, action="link", pay_id=pay_id))
    assert r.status_code == 200, r.text
    [pay] = pays()
    assert (pay.id, pay.paid_on, pay.net_cents, pay.confirmed) == (
        pay_id,
        date(2026, 3, 20),
        210000,
        True,
    )


def test_preview_proposes_a_near_typed_pay_to_check(client):
    pay_id = type_pay(date(2026, 3, 20), 205000)  # a typo, over 1% off
    p = preview(client, EARLY).json()
    assert p["main_job"][0]["proposal"] == {
        "kind": "link",
        "pay_id": pay_id,
        "pay": {"paid_on": "2026-03-20", "net_cents": 205000},
        "check_amount": True,
    }


def test_confirm_links_a_pay_that_was_not_proposed(client):
    pay_id = type_pay(date(2026, 3, 10), 205000)  # a typo in both date and amount
    p = preview(client, EARLY).json()
    assert p["main_job"][0]["proposal"]["kind"] == "new"
    r = confirm(client, main_choices(p, action="link", pay_id=pay_id))
    assert r.status_code == 200, r.text
    [pay] = pays()
    assert (pay.net_cents, pay.confirmed) == (210000, True)


def test_confirm_refuses_one_pay_linked_twice(app, client):
    pay_id = type_pay(date(2026, 3, 20), 210000)
    two = statement(
        "2026-03-19,Deposit,DAY JOB PAY,2100.00,3066.90,CAD",
        "2026-03-20,Deposit,DAY JOB PAY,2100.00,5166.90,CAD",
    )
    p = preview(client, two).json()
    r = confirm(client, main_choices(p, action="link", pay_id=pay_id))
    assert r.status_code == 422
    assert "only be confirmed by one deposit" in r.json()["detail"]
    assert (count(app, "deposits"), count(app, "statement_imports")) == (0, 0)


def test_confirm_link_needs_a_pay(client):
    type_pay(date(2026, 3, 20), 210000)
    p = preview(client, EARLY).json()
    r = confirm(client, main_choices(p, action="link"))
    assert r.status_code == 422
    assert "Pick which typed-in pay" in r.json()["detail"]


def test_confirm_link_to_already_confirmed_pay_conflicts(app, client):
    pay_id = type_pay(date(2026, 3, 20), 210000)
    p = preview(client, EARLY).json()
    other = statement("2026-03-21,Deposit,DAY JOB PAY,2100.00,7000.00,CAD")
    q = preview(client, other).json()
    assert confirm(client, main_choices(q, action="link", pay_id=pay_id)).status_code == 200
    r = confirm(client, main_choices(p, action="link", pay_id=pay_id))
    assert r.status_code == 409
    assert "confirmed meanwhile" in r.json()["detail"]
    assert (count(app, "deposits"), count(app, "statement_imports")) == (1, 1)


def test_confirm_skip_main_job_deposit(app, client):
    p = preview(client, EARLY).json()
    r = confirm(client, main_choices(p, action="skip"))
    assert r.json()["skipped"] == 1
    assert count(app, "deposits") == 0
    assert pays() == []


def test_skipped_rows_and_spending_are_never_stored(app, client):
    p = preview(client).json()
    r = confirm(client, decisions(p, refund="skip"))
    assert r.json()["skipped"] == 1
    conn = open_database(db_path(DbKind.PERSONAL), DbKind.PERSONAL)
    try:
        amounts = {row[0] for row in conn.execute("SELECT amount_cents FROM deposits")}
        dump = "\n".join(conn.iterdump())
    finally:
        conn.close()
    assert 1200 not in amounts and 4510 not in amounts
    for word in ("GROCER", "REFUND", "NIMBUS", "DAY JOB", "96690"):
        assert word not in dump


def test_importing_the_same_statement_again_doubles_nothing(app, client):
    confirm(client, decisions(preview(client).json()))
    p = preview(client).json()
    assert p["already_imported"] == 4
    assert p["platform"] == [] and p["main_job"] == [] and p["other_income"] == []
    assert count(app, "deposits") == 4


def test_an_overlapping_statement_keeps_only_new_rows(app, client):
    confirm(client, decisions(preview(client).json(), refund="skip"))
    later = statement(
        "2026-03-20,Deposit,DAY JOB PAY,2100.00,3066.90,CAD",
        "2026-04-03,Deposit,DAY JOB PAY,2100.00,5166.90,CAD",
    )
    p = preview(client, later).json()
    assert p["already_imported"] == 1 and len(p["main_job"]) == 1
    assert confirm(client, decisions(p)).json()["kept"] == 1


def test_a_token_works_once(client):
    p = preview(client).json()
    assert confirm(client, decisions(p)).status_code == 200
    assert confirm(client, decisions(p)).status_code == 409


def test_an_old_preview_expires(client, clock):
    p = preview(client).json()
    clock.now = NOW + timedelta(minutes=16)
    assert confirm(client, decisions(p)).status_code == 409


def test_a_mode_switch_drops_the_preview(app, client):
    p = preview(client).json()
    client.put("/api/mode", json={"mode": "sample"})
    client.put("/api/mode", json={"mode": "personal"})
    client.headers["X-Vault-Key"] = client.post("/api/vault/unlock").json()["key"]
    assert confirm(client, decisions(p)).status_code == 409


def test_a_week_paid_meanwhile_stops_the_whole_import(app, client):
    p = preview(client).json()
    ids = [
        e["id"] for g in client.get("/api/vault/side-work").json()["groups"] for e in g["entries"]
    ]
    client.post(
        "/api/vault/side-work/payments",
        json={
            "kind": "pay",
            "received_on": "2026-03-22",
            "amount": "140",
            "currency": "USD",
            "entry_ids": ids,
        },
    )
    before = count(app, "deposits")
    r = confirm(client, decisions(p))
    assert r.status_code == 409
    assert count(app, "deposits") == before == 0


def test_every_platform_deposit_needs_a_decision(client):
    p = preview(client).json()
    body = decisions(p)
    body["platform"] = body["platform"][:1]
    assert confirm(client, body).status_code == 422


# --- Sample mode's demo statement ----------------------------------------------------------


def test_sample_statement_previews_with_every_kind(data_dir, clock):
    from aicity.sample_data import seed_sample_database

    seed_sample_database(clock=lambda: NOW)
    app = create_app(dev=False)
    app.state.db_kind = DbKind.SAMPLE
    app.state.clock = clock
    c = TestClient(app, base_url=APP_URL, headers={"origin": APP_URL})
    csv_text = c.get("/api/vault/statements/sample.csv")
    assert csv_text.status_code == 200
    assert csv_text.headers["content-type"].startswith("text/csv")
    p = preview(c, csv_text.content).json()
    kinds = {row["proposal"]["kind"] for row in p["platform"]}
    assert {"week", "bonus"} <= kinds
    assert len(p["main_job"]) == 1 and len(p["other_income"]) >= 1
    assert p["spending"] >= 2 and p["other_currency"] >= 1
    assert confirm(c, decisions(p)).status_code == 200


def test_sample_statement_proposes_link_to_typed_pay(data_dir, clock):
    from aicity.sample_data import seed_sample_database

    seed_sample_database(clock=lambda: NOW)
    app = create_app(dev=False)
    app.state.db_kind = DbKind.SAMPLE
    app.state.clock = clock
    c = TestClient(app, base_url=APP_URL, headers={"origin": APP_URL})
    [waiting] = [r for r in c.get("/api/vault/income").json()["main_job_pay"] if not r["confirmed"]]
    p = preview(c, c.get("/api/vault/statements/sample.csv").content).json()
    [row] = p["main_job"]
    assert row["proposal"]["kind"] == "link"
    assert row["proposal"]["pay_id"] == waiting["id"]
    assert row["day"] < waiting["day"]  # the bank posts it a day early
    body = decisions(p)
    body["main_job"] = [{"ref": row["ref"], "action": "link", "pay_id": waiting["id"]}]
    assert confirm(c, body).status_code == 200
    after = next(
        r for r in c.get("/api/vault/income").json()["main_job_pay"] if r["id"] == waiting["id"]
    )
    assert (after["confirmed"], after["day"]) == (True, waiting["day"])


def test_sample_statement_is_not_offered_in_personal(client):
    assert client.get("/api/vault/statements/sample.csv").status_code == 404


def test_trying_the_sample_statement_twice_never_doubles_pay(data_dir, clock):
    from aicity.sample_data import seed_sample_database

    seed_sample_database(clock=lambda: NOW)
    app = create_app(dev=False)
    app.state.db_kind = DbKind.SAMPLE
    app.state.clock = clock
    c = TestClient(app, base_url=APP_URL, headers={"origin": APP_URL})
    first = preview(c, c.get("/api/vault/statements/sample.csv").content).json()
    confirm(c, decisions(first))
    again = preview(c, c.get("/api/vault/statements/sample.csv").content).json()
    assert again["main_job"] == []  # the same pay row: already imported
    assert again["already_imported"] >= 1


# --- Review fixes ---------------------------------------------------------------------------


def hand_pay_mar7_week(client):
    ids = [
        e["id"] for g in client.get("/api/vault/side-work").json()["groups"] for e in g["entries"]
    ]
    r = client.post(
        "/api/vault/side-work/payments",
        json={
            "kind": "pay",
            "company": "platform_a",
            "received_on": "2026-03-18",
            "amount": "191",
            "currency": "CAD",
            "entry_ids": ids,
        },
    )
    assert r.status_code == 201, r.text
    client.post(
        "/api/vault/side-work/entries",
        json={
            "worked_on": "2026-03-16",
            "company": "platform_a",
            "hours": "1",
            "rate": "40",
            "currency": "USD",
        },
    )
    return r.json()["id"]


def test_a_payment_typed_by_hand_is_linked_not_counted_again(app, client):
    pid = hand_pay_mar7_week(client)
    p = preview(
        client, statement("2026-03-22,Deposit,NIMBUS LABS PAYOUT,191.00,3257.90,CAD")
    ).json()
    [row] = p["platform"]
    assert (row["proposal"]["kind"], row["proposal"]["payment_id"]) == ("link", pid)
    assert [h["id"] for h in p["hand_payments"]] == [pid]
    confirm(client, decisions(p))
    assert client.get("/api/vault/side-work").json()["summary"]["month_received_cad_cents"] == 19100


def test_a_week_cannot_be_paid_before_its_pay_could_land(client):
    hand_pay_mar7_week(client)
    p = preview(
        client, statement("2026-03-22,Deposit,NIMBUS LABS PAYOUT,191.00,3257.90,CAD")
    ).json()
    body = decisions(p)
    body["platform"][0].update(action="week", week_start="2026-03-14", payment_id=None)
    r = confirm(client, body)
    assert r.status_code == 422
    assert "week" in r.json()["detail"].lower()


@pytest.mark.parametrize("action", ["bonus", "link"])
def test_a_bonus_amount_only_goes_with_a_weeks_pay(client, action):
    pid = hand_pay_mar7_week(client)
    p = preview(
        client, statement("2026-03-22,Deposit,NIMBUS LABS PAYOUT,191.00,3257.90,CAD")
    ).json()
    body = decisions(p)
    body["platform"][0].update(
        action=action, payment_id=pid, week_start=None, includes_bonus=True, bonus="5"
    )
    r = confirm(client, body)
    assert r.status_code == 422
    assert "bonus" in r.json()["detail"].lower()


def test_identical_rows_with_no_balance_are_both_kept(app, client):
    body = statement(
        "2026-03-20,Deposit,DAY JOB PAY,100.00,,CAD",
        "2026-03-20,Deposit,DAY JOB PAY,100.00,,CAD",
    )
    p = preview(client, body).json()
    assert len(p["main_job"]) == 2 and p["already_imported"] == 0
    confirm(client, decisions(p))
    again = preview(client, body).json()
    assert again["main_job"] == [] and again["already_imported"] == 2
