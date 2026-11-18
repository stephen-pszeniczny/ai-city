"""Tests for which reminders make a Mac notification (src/aicity/mac_messages.py).

Only the Personal database's new reminders reach this rule. Quiet when the owner
is looking at the app in Personal mode (the shuttle shows it). In Sample mode
the title never appears. Several at once become one summary with no titles.
"""

from aicity.mac_messages import MacMessage, plan_mac_messages


def test_nothing_new_nothing_to_say():
    assert plan_mac_messages([], sample_mode=False, looking=False) == []


def test_looking_in_personal_mode_stays_quiet():
    assert plan_mac_messages(["Call the garage"], sample_mode=False, looking=True) == []


def test_one_reminder_shows_its_title_when_not_looking():
    assert plan_mac_messages(["Call the garage"], sample_mode=False, looking=False) == [
        MacMessage("Reminder", "Call the garage")
    ]


def test_sample_mode_never_shows_the_title():
    for looking in (False, True):
        [m] = plan_mac_messages(["Call the garage"], sample_mode=True, looking=looking)
        assert m == MacMessage("Reminder", "You have a reminder")


def test_several_become_one_summary_without_titles():
    titles = [f"Private thing {i}" for i in range(5)]
    for sample_mode in (False, True):
        [m] = plan_mac_messages(titles, sample_mode=sample_mode, looking=False)
        assert m == MacMessage("Reminders", "5 reminders came due")
        assert "Private" not in m.title + m.body


def test_long_title_is_cut():
    [m] = plan_mac_messages(["word " * 30], sample_mode=False, looking=False, max_chars=60)
    assert len(m.body) <= 60
    assert m.body.endswith("…")
