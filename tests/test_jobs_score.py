"""Rules scoring of a posting against a search profile (made-up postings only)."""

from dataclasses import replace
from decimal import Decimal

import pytest

from aicity.jobs_score import Posting, background_for, score_posting
from aicity.jobs_settings import JobProfile
from aicity.jobs_text import Facts, Pay

PROFILE = JobProfile(
    id="ai_training",
    name="AI training",
    active=True,
    pay_floor_usd=Decimal(30),
    pay_preferred_usd=Decimal(40),
    hours=(10, 15),
    job_types=("contract", "part_time", "temporary", "freelance"),
    title_words=("ai trainer", "red team"),
    exclude_words=("recruiter",),
    location_ok=("canada",),
    skills=("python", "technical writing", "data analysis", "spreadsheets", "statistics"),
    gap_words=("sql", "javascript", "rust", "go", "docker", "kubernetes", "python"),
)
FACTS = Facts(remote="yes", canada_ok="yes", job_type="contract", hours=None)


def posting(**overrides) -> Posting:
    base = Posting(
        title="AI Trainer",
        company="Nimbus Data",
        location="Remote - Canada",
        text="You will use Python, technical writing, data analysis, spreadsheets and statistics.",
        pay=Pay(6500, 12500, "USD", "hour", "$65 – $125 per hour"),
        facts=FACTS,
    )
    return replace(base, **overrides)


def usd(low: float | None, high: float | None = None, currency="USD", unit="hour") -> Pay:
    def c(v):
        return None if v is None else round(v * 100)

    return Pay(c(low), c(high if high is not None else low), currency, unit, "pay")


@pytest.mark.parametrize(
    ("overrides", "reason"),
    [
        ({"facts": replace(FACTS, remote="no")}, "not_remote"),
        ({"facts": replace(FACTS, canada_ok="no")}, "not_canada"),
        ({"facts": replace(FACTS, job_type="full_time")}, "full_time"),
        ({"pay": usd(20, 25)}, "below_floor"),
        ({"title": "Technical Recruiter"}, "excluded_word"),
    ],
)
def test_drops(overrides, reason):
    result = score_posting(posting(**overrides), PROFILE, None)
    assert result.keep is False
    assert result.drop_reason == reason


def test_strong_match_scores_100():
    result = score_posting(posting(), PROFILE, None)
    assert result.keep is True
    assert result.score == 100
    assert result.verdict == "strong"
    assert set(result.matched) == set(PROFILE.skills)
    assert result.flags == ()


def test_pay_parts():
    def pay_part(pay):
        full = score_posting(posting(pay=usd(65)), PROFILE, Decimal("1.40")).score
        return 25 - (full - score_posting(posting(pay=pay), PROFILE, Decimal("1.40")).score)

    assert pay_part(usd(35)) == 15
    assert pay_part(usd(25, 35)) == 8
    assert pay_part(usd(45, 0 + 45, currency="CAD")) == 15  # 45 / 1.40 = 32.14 USD
    assert pay_part(usd(None, None, unit="unknown")) == 0


def test_straddling_range_is_kept_and_flagged():
    result = score_posting(posting(pay=usd(25, 35)), PROFILE, None)
    assert result.keep is True
    assert "straddles_floor" in result.flags


def test_cad_without_a_rate_is_pay_not_listed():
    result = score_posting(posting(pay=usd(45, currency="CAD")), PROFILE, None)
    assert result.keep is True
    assert "pay_not_listed" in result.flags


def test_yearly_pay_is_pay_not_listed():
    result = score_posting(posting(pay=usd(120000, unit="year")), PROFILE, None)
    assert "pay_not_listed" in result.flags


def test_other_currency_is_pay_not_listed():
    assert (
        "pay_not_listed"
        in score_posting(posting(pay=usd(25, currency="OTHER")), PROFILE, None).flags
    )


def test_canada_unknown_is_flagged():
    result = score_posting(posting(facts=replace(FACTS, canada_ok="unknown")), PROFILE, None)
    assert result.keep is True
    assert "canada_unknown" in result.flags


def test_hours_outside_the_range_lose_their_part():
    inside = score_posting(posting(facts=replace(FACTS, hours=(10, 20))), PROFILE, None).score
    outside = score_posting(posting(facts=replace(FACTS, hours=(30, 40))), PROFILE, None).score
    assert inside - outside == 10


def test_gaps_capped_at_five_and_never_a_background_skill():
    text = "SQL, JavaScript, Rust, Go, Docker, Kubernetes and Python."
    result = score_posting(posting(text=text), PROFILE, None)
    assert result.gaps == ("sql", "javascript", "rust", "go", "docker")
    assert "python" not in result.gaps


def test_skill_matching_uses_whole_words():
    result = score_posting(
        posting(text="We value gopher enthusiasts.", title="AI Trainer"), PROFILE, None
    )
    assert "go" not in result.gaps


def test_weak_match_is_skip_verdict():
    result = score_posting(
        posting(title="Evaluator", text="Nothing relevant.", pay=usd(None, None, unit="unknown")),
        PROFILE,
        None,
    )
    assert result.keep is True
    assert result.verdict == "skip"


def test_background_comes_from_the_profile_for_now():
    assert background_for(PROFILE) == PROFILE.skills


def test_job_type_not_in_the_profile_is_dropped():
    profile = replace(PROFILE, job_types=("contract", "part_time"))
    result = score_posting(posting(facts=replace(FACTS, job_type="temporary")), profile, None)
    assert (result.keep, result.drop_reason) == (False, "job_type")


def test_unknown_job_type_is_kept():
    profile = replace(PROFILE, job_types=("contract",))
    assert score_posting(posting(facts=replace(FACTS, job_type="unknown")), profile, None).keep


def test_title_word_matches_the_start_of_a_word():
    plain = score_posting(posting(title="Evaluator"), PROFILE, None).score
    teamer = score_posting(posting(title="AI Red Teamer"), PROFILE, None).score
    assert teamer - plain == 15
