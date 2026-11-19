"""Tests for proposing matches between imported deposits and expected side-work pay.

Weeks run Saturday to Friday; a week ending Fri Mar 13 lands Mar 21-23 (window),
so with 2 days' slack a deposit from Mar 19 to Mar 25 fits. Values are invented.
"""

from datetime import date, timedelta
from decimal import Decimal

from aicity.income_match import HandPayment, OpenWeek, TypedPay, propose, propose_main_job
from aicity.statement_csv import StatementRow

WEEK1 = date(2026, 3, 7)  # Sat; window Mar 21-23
WEEK2 = date(2026, 3, 14)  # window Mar 28-30


def week(start, cad=None, usd=None, partial=False, entry_ids=(1,)):
    end = start + timedelta(days=6)
    expected = {}
    if cad is not None:
        expected["CAD"] = cad
    if usd is not None:
        expected["USD"] = usd
    return OpenWeek(
        schedule_id="platform_a",
        start=start,
        window=(end + timedelta(days=8), end + timedelta(days=10)),
        entry_ids=list(entry_ids),
        expected_by_currency=expected,
        partial=partial,
    )


def row(day, cents, line=2):
    return StatementRow(line, day, "Deposit", "NIMBUS LABS", cents, None, "CAD")


def rate(_day):
    return Decimal("1.40")


def run(rows, weeks, paid=(), rate_for=rate):
    return propose({"platform_a": rows}, weeks, list(paid), rate_for)


def test_close_amount_in_the_window_is_that_week():
    [p] = run([row(date(2026, 3, 22), 9800)], [week(WEEK1, cad=10000)])
    assert (p.kind, p.week_start, p.check_amount) == ("week", WEEK1, False)


def test_usd_week_is_compared_in_cad_at_the_days_rate():
    [p] = run(
        [row(date(2026, 3, 22), 13860)], [week(WEEK1, usd=10000)]
    )  # 140.00 expected, 1% under
    assert p.kind == "week"


def test_amount_too_far_off_is_unmatched():
    [p] = run([row(date(2026, 3, 22), 9399)], [week(WEEK1, cad=10000)])
    assert p.kind == "unmatched"


def test_window_has_two_days_of_slack():
    assert run([row(date(2026, 3, 25), 10000)], [week(WEEK1, cad=10000)])[0].kind == "week"
    assert run([row(date(2026, 3, 26), 10000)], [week(WEEK1, cad=10000)])[0].kind == "unmatched"
    assert run([row(date(2026, 3, 19), 10000)], [week(WEEK1, cad=10000)])[0].kind == "week"


def test_closer_amount_wins_then_earlier_week():
    weeks = [week(WEEK1, cad=10000), week(WEEK2, cad=10300, entry_ids=(2,))]
    # Mar 27 fits WEEK1 (to Mar 25)? No. Use a day inside both widened windows.
    d = date(2026, 3, 26)  # WEEK1 widened to Mar 25: no; WEEK2 widened from Mar 26: yes
    assert run([row(d, 10250)], weeks)[0].week_start == WEEK2
    both = [week(WEEK1, cad=10000), week(date(2026, 3, 8), cad=10000, entry_ids=(2,))]
    assert run([row(date(2026, 3, 22), 10000)], both)[0].week_start == WEEK1


def test_each_week_is_used_once():
    rows = [row(date(2026, 3, 22), 10000, line=2), row(date(2026, 3, 22), 10000, line=3)]
    ps = run(rows, [week(WEEK1, cad=10000)])
    assert [p.kind for p in ps] == ["week", "bonus"]  # the second is near the first: bonus


def test_smaller_second_deposit_soon_after_is_the_bonus():
    rows = [row(date(2026, 3, 22), 10000, line=2), row(date(2026, 3, 23), 2000, line=3)]
    ps = run(rows, [week(WEEK1, cad=10000)])
    assert [(p.kind, p.week_start) for p in ps] == [("week", WEEK1), ("bonus", WEEK1)]


def test_deposit_far_from_any_pay_is_unmatched_not_bonus():
    rows = [row(date(2026, 3, 22), 10000, line=2), row(date(2026, 4, 2), 2000, line=3)]
    assert run(rows, [week(WEEK1, cad=10000)])[1].kind == "unmatched"


def test_deposit_matching_a_hand_typed_payment_is_linked():
    paid = [
        HandPayment(
            payment_id=7,
            schedule_id="platform_a",
            received_on=date(2026, 3, 21),
            amount_cad_cents=10000,
        )
    ]
    [p] = run([row(date(2026, 3, 23), 10100)], [], paid)
    assert (p.kind, p.payment_id) == ("link", 7)


def test_hand_payment_too_different_is_not_linked():
    paid = [HandPayment(7, "platform_a", date(2026, 3, 21), 10000)]
    assert run([row(date(2026, 3, 23), 12000)], [], paid)[0].kind != "link"


def test_bonus_near_a_hand_typed_payment():
    paid = [HandPayment(7, "platform_a", date(2026, 3, 21), 10000)]
    [p] = run([row(date(2026, 3, 22), 2000)], [], paid)
    assert (p.kind, p.payment_id) == ("bonus", 7)


def test_partial_week_only_when_it_is_the_only_fit():
    [p] = run([row(date(2026, 3, 22), 9000)], [week(WEEK1, partial=True)])
    assert (p.kind, p.check_amount) == ("week", True)
    two = [week(WEEK1, partial=True), week(date(2026, 3, 8), partial=True, entry_ids=(2,))]
    assert run([row(date(2026, 3, 22), 9000)], two)[0].kind == "unmatched"


def test_missing_rate_counts_as_unknown_amount():
    [p] = run([row(date(2026, 3, 22), 9000)], [week(WEEK1, usd=10000)], rate_for=lambda d: None)
    assert (p.kind, p.check_amount) == ("week", True)


def test_oldest_deposit_is_matched_first():
    rows = [row(date(2026, 3, 29), 10000, line=3), row(date(2026, 3, 22), 10000, line=2)]
    ps = run(rows, [week(WEEK1, cad=10000), week(WEEK2, cad=10000, entry_ids=(2,))])
    by_line = {p.row.line: p for p in ps}
    assert (by_line[2].week_start, by_line[3].week_start) == (WEEK1, WEEK2)


def test_when_two_weeks_fit_the_closer_amount_wins():
    # Both windows hold Mar 22; the deposit is 0.1% from the second week, 1.9% from the first.
    weeks = [week(WEEK1, cad=10000), week(date(2026, 3, 8), cad=10200, entry_ids=(2,))]
    assert run([row(date(2026, 3, 22), 10190)], weeks)[0].week_start == date(2026, 3, 8)


def test_hand_payment_typed_with_the_paid_day_still_links():
    # Typed with the platform's "paid" day; the deposit lands 4 days later.
    paid = [HandPayment(7, "platform_a", date(2026, 3, 18), 19100)]
    later = week(WEEK2, cad=5000, entry_ids=(9,))
    [p] = run([row(date(2026, 3, 22), 19100)], [later], paid)
    assert (p.kind, p.payment_id) == ("link", 7)


# --- Main-job pay: link to pay typed in by hand (3 days, 1%) --------------------------------

PAYDAY = date(2026, 3, 20)


def kinds(proposals):
    return [(p.kind, p.pay_id) for p in proposals]


def test_main_job_deposit_a_day_early_links():
    out = propose_main_job([row(PAYDAY - timedelta(days=1), 150000)], [TypedPay(7, PAYDAY, 150000)])
    assert kinds(out) == [("link", 7)]


def test_main_job_link_edges():
    typed = [TypedPay(7, PAYDAY, 150000)]

    def got(day, cents):
        [p] = propose_main_job([row(day, cents)], typed)
        return (p.kind, p.pay_id, p.check_amount)

    assert got(PAYDAY + timedelta(days=3), 150000) == ("link", 7, False)
    assert got(PAYDAY - timedelta(days=4), 150000) == ("new", None, False)
    assert got(PAYDAY, 151500) == ("link", 7, False)  # exactly 1%
    assert got(PAYDAY, 151501) == ("link", 7, True)  # over 1%: a link to check
    assert got(PAYDAY, 148500) == ("link", 7, False)
    assert got(PAYDAY, 148499) == ("link", 7, True)


def test_main_job_two_paydays_each_link_once():
    later = PAYDAY + timedelta(days=14)
    typed = [TypedPay(8, later, 150000), TypedPay(7, PAYDAY, 150000)]
    out = propose_main_job(
        [row(later - timedelta(days=1), 150000, line=3), row(PAYDAY, 150000, line=2)], typed
    )
    assert kinds(out) == [("link", 8), ("link", 7)]  # same order as the rows given


def test_main_job_one_typed_pay_links_one_deposit():
    out = propose_main_job(
        [row(PAYDAY, 150000, line=2), row(PAYDAY, 150000, line=3)], [TypedPay(7, PAYDAY, 150000)]
    )
    assert kinds(out) == [("link", 7), ("new", None)]


def test_main_job_closest_amount_wins():
    typed = [TypedPay(7, PAYDAY, 150000), TypedPay(8, PAYDAY, 151000)]
    assert kinds(propose_main_job([row(PAYDAY, 150900)], typed)) == [("link", 8)]


def test_main_job_closest_day_breaks_an_amount_tie():
    typed = [TypedPay(7, PAYDAY - timedelta(days=2), 150000), TypedPay(8, PAYDAY, 150000)]
    assert kinds(propose_main_job([row(PAYDAY, 150000)], typed)) == [("link", 8)]


def test_main_job_no_typed_pay_is_new():
    assert kinds(propose_main_job([row(PAYDAY, 150000)], [])) == [("new", None)]


def test_main_job_near_typed_pay_over_1_percent_is_a_link_to_check():
    # A typo (2% off) on the right payday: proposed as the link, flagged, so the
    # default isn't a second pay for the same day.
    out = propose_main_job([row(PAYDAY, 153000)], [TypedPay(7, PAYDAY, 150000)])
    assert [(p.kind, p.pay_id, p.check_amount) for p in out] == [("link", 7, True)]


def test_main_job_exact_match_wins_over_a_near_one():
    typed = [TypedPay(7, PAYDAY, 150000)]
    out = propose_main_job(
        [row(PAYDAY - timedelta(days=1), 160000, line=2), row(PAYDAY, 150000, line=3)], typed
    )
    assert [(p.kind, p.pay_id, p.check_amount) for p in out] == [
        ("new", None, False),
        ("link", 7, False),
    ]


def test_main_job_near_needs_the_same_three_days():
    out = propose_main_job([row(PAYDAY + timedelta(days=4), 153000)], [TypedPay(7, PAYDAY, 150000)])
    assert [(p.kind, p.check_amount) for p in out] == [("new", False)]
