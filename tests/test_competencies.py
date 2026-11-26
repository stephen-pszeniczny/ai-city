"""The engineering regulator's competency list (34 competencies in 7 categories)."""

import pytest

from aicity.competencies import CATEGORIES, COMPETENCIES, LIMITS, competency


def test_seven_categories():
    assert sorted(CATEGORIES) == [1, 2, 3, 4, 5, 6, 7]
    assert CATEGORIES[2] == "Communication"


def test_thirty_four_competencies_with_matching_categories():
    assert len(COMPETENCIES) == 34
    assert len({c.id for c in COMPETENCIES}) == 34
    for c in COMPETENCIES:
        assert int(c.id.split(".")[0]) == c.category
    counts = [sum(c.category == n for c in COMPETENCIES) for n in range(1, 8)]
    assert counts == [10, 3, 5, 2, 6, 5, 3]


def test_order_and_lookup():
    assert [c.id for c in COMPETENCIES][:3] == ["1.1", "1.2", "1.3"]
    assert COMPETENCIES[9].id == "1.10"
    assert competency("7.3").category == 7
    with pytest.raises(KeyError):
        competency("9.9")


def test_professional_standards():
    marked = [c.id for c in COMPETENCIES if c.professional_standards]
    assert marked == ["1.1", "1.6", "1.9", "2.3", "5.1", "6.2"]


def test_limits():
    assert LIMITS == {"situation": 300, "action": 1650, "outcome": 300}


def test_names_are_clean():
    for c in COMPETENCIES:
        assert 10 < len(c.name) < 200
        assert "standards competency" not in c.name
        assert c.name == " ".join(c.name.split())
