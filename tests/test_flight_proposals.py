"""Flight School proposals: the shape every model suggestion must have before it's saved."""

import pytest

from aicity.flight_proposals import FlightError, validate_payload, validate_proposals

GOOD = {
    "bullet": {
        "text": "Reviewed a ventilation design with two other disciplines",
        "skills": ["Design review"],
        "competencies": ["1.4", "4.1"],
    },
    "example": {"competency": "2.2", "situation": "S", "action": "I wrote…", "outcome": "O"},
    "new_skill": {
        "name": "Design review",
        "category": 1,
        "level": 2,
        "related": ["Python"],
        "competencies": ["1.9"],
    },
    "level_change": {"skill": "Python", "to": 3, "evidence": "Automated a calculation"},
    "recommendation": {
        "skill": "Python",
        "kind": "course",
        "title": "Python for engineers",
        "provider": "Example U",
        "url": "https://example.com/c",
        "price": "Free",
        "free": True,
    },
    "resume_change": {
        "section": "Experience",
        "action": "add",
        "item": None,
        "text": "Reviewed designs across disciplines",
    },
}


@pytest.mark.parametrize("kind", list(GOOD))
def test_good_payloads(kind):
    assert validate_payload(kind, GOOD[kind]) == GOOD[kind]


def test_a_good_file():
    items = [{"kind": k, "payload": p} for k, p in GOOD.items()]
    assert validate_proposals(items) == items


@pytest.mark.parametrize(
    ("kind", "change", "field"),
    [
        ("example", {"action": "x" * 1651}, "action"),
        ("example", {"situation": "x" * 301}, "situation"),
        ("example", {"competency": "9.9"}, "competency"),
        ("new_skill", {"level": 7}, "level"),
        ("new_skill", {"category": 0}, "category"),
        ("level_change", {"to": 0}, "to"),
        ("recommendation", {"url": "http://example.com"}, "url"),
        ("recommendation", {"free": "yes"}, "free"),
        ("bullet", {"text": ""}, "text"),
        ("bullet", {"competencies": ["1.99"]}, "competencies"),
        ("resume_change", {"action": "rewrite"}, "action"),
        ("resume_change", {"action": "replace", "item": None}, "item"),
        ("bullet", {"extra": 1}, "extra"),
    ],
)
def test_bad_payloads_name_the_field(kind, change, field):
    with pytest.raises(FlightError, match=field):
        validate_payload(kind, {**GOOD[kind], **change})


def test_missing_field():
    payload = dict(GOOD["bullet"])
    del payload["text"]
    with pytest.raises(FlightError, match="text"):
        validate_payload("bullet", payload)


def test_one_bad_item_refuses_the_whole_file_and_names_it():
    items = [
        {"kind": "bullet", "payload": GOOD["bullet"]},
        {"kind": "example", "payload": {**GOOD["example"], "outcome": "x" * 301}},
    ]
    with pytest.raises(FlightError, match="item 2") as err:
        validate_proposals(items)
    assert "xxx" not in str(err.value)  # never echoes the text


@pytest.mark.parametrize(
    "data",
    [{}, "text", None, [{"kind": "poem", "payload": {}}], [{"kind": "bullet"}], [[]]],
)
def test_bad_file_shapes(data):
    with pytest.raises(FlightError):
        validate_proposals(data)


def test_empty_file_is_refused():
    with pytest.raises(FlightError, match="no proposals"):
        validate_proposals([])
