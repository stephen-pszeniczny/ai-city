"""Which new reminders become a Mac notification, and what it says.

Only the Personal database's newly made reminders reach this rule (Sample's
made-up ones never make Mac notifications). Then:
  - looking at the app in Personal mode: nothing (the shuttle and ticker show it);
  - otherwise one notification, "Reminder" + the task title;
  - in Sample mode the title never appears: "You have a reminder" (so a real task
    can't show up during a demo or a screen recording);
  - several at once: one summary, "<N> reminders came due", with no titles, so a
    Mac waking with many due never floods.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class MacMessage:
    title: str
    body: str


def plan_mac_messages(
    new_titles: list[str], *, sample_mode: bool, looking: bool, max_chars: int = 60
) -> list[MacMessage]:
    if not new_titles:
        return []
    if looking and not sample_mode:
        return []
    if len(new_titles) > 1:
        return [MacMessage("Reminders", f"{len(new_titles)} reminders came due")]
    if sample_mode:
        return [MacMessage("Reminder", "You have a reminder")]
    return [MacMessage("Reminder", _one_line(new_titles[0], max_chars))]


def _one_line(text: str, max_chars: int) -> str:
    t = " ".join(text.split())
    if len(t) <= max_chars:
        return t
    cut = t[: max_chars - 1]
    space = cut.rfind(" ")
    if space > max_chars // 2:
        cut = cut[:space]
    return cut.rstrip() + "…"
