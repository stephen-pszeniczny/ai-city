"""Reading pay and facts from job posting text (made-up postings only)."""

import pytest

from aicity.jobs_text import Pay, normalise_company, normalise_title, parse_pay, read_facts

OK = ("canada", "worldwide", "anywhere", "north america")


def test_hourly_range_in_usd():
    assert parse_pay("Pay: $65 – $125 per hour, paid weekly") == Pay(
        6500, 12500, "USD", "hour", "$65 – $125 per hour"
    )


@pytest.mark.parametrize(
    ("text", "low", "high", "currency", "unit"),
    [
        ("$40/hr", 4000, 4000, "USD", "hour"),
        ("USD 40/hour", 4000, 4000, "USD", "hour"),
        ("up to $50/hr", None, 5000, "USD", "hour"),
        ("$30-45 CAD per hour", 3000, 4500, "CAD", "hour"),
        ("CA$30–45/hr", 3000, 4500, "CAD", "hour"),
        ("$32.50 an hour", 3250, 3250, "USD", "hour"),
        ("$120,000/year", 12_000_000, 12_000_000, "USD", "year"),
        ("$40k", 4_000_000, 4_000_000, "USD", "year"),
        ("$90k - $110k", 9_000_000, 11_000_000, "USD", "year"),
        ("£25/hr", 2500, 2500, "OTHER", "hour"),
        ("€30 per hour", 3000, 3000, "OTHER", "hour"),
    ],
)
def test_pay_shapes(text, low, high, currency, unit):
    pay = parse_pay(text)
    assert (pay.low, pay.high, pay.currency, pay.unit) == (low, high, currency, unit)
    assert pay.text and len(pay.text) <= 80


def test_no_pay():
    assert parse_pay("Competitive pay, flexible hours") == Pay(None, None, None, "unknown", "")


def test_a_bare_large_figure_is_never_hourly():
    assert parse_pay("Budget $5,000 for the project").unit != "hour"


def test_facts_remote_canada():
    f = read_facts("AI trainer", "Remote - Canada", "", OK)
    assert (f.remote, f.canada_ok) == ("yes", "yes")


def test_facts_us_only():
    assert read_facts("AI trainer", "Remote (US only)", "", OK).canada_ok == "no"


def test_facts_country_list_without_canada():
    assert (
        read_facts("AI trainer", "Remote - United States, United Kingdom", "", OK).canada_ok == "no"
    )


def test_facts_remote_with_no_country():
    f = read_facts("AI trainer", "Remote", "", OK)
    assert (f.remote, f.canada_ok) == ("yes", "unknown")


def test_facts_on_site():
    assert read_facts("AI trainer", "San Francisco, CA", "Work on-site 5 days.", OK).remote == "no"


def test_facts_full_time():
    assert (
        read_facts("AI trainer", "Remote", "This is a full-time role.", OK).job_type == "full_time"
    )


def test_facts_contract_in_title():
    assert read_facts("AI Trainer (Contract)", "Remote", "", OK).job_type == "contract"


def test_facts_part_time():
    assert read_facts("Evaluator", "Remote", "Part-time, flexible.", OK).job_type == "part_time"


def test_facts_hours():
    assert read_facts("Evaluator", "Remote", "About 10-20 hours per week.", OK).hours == (10, 20)
    assert read_facts("Evaluator", "Remote", "Up to 15 hrs/week", OK).hours == (1, 15)
    assert read_facts("Evaluator", "Remote", "", OK).hours is None


def test_normalise_title():
    assert normalise_title("AI Trainer (Remote, Contract) – Canada") == normalise_title(
        "ai trainer"
    )
    assert normalise_title("Part-time Evaluator") == normalise_title("evaluator")


def test_normalise_company():
    assert normalise_company("Nimbus Data, Inc.") == normalise_company("nimbus data inc")
