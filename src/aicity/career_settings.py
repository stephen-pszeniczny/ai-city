"""Flight School settings: the optional [career] section.

ai picks who analyses the monthly log: "claude_code" (default: Opus, run by the owner
inside Claude Code on his plan) or "local" (a model in Ollama on this Mac, which then
needs local_model). reminder_day is the day of the month the "log last month" to-do
appears (1 to 28).
"""

from dataclasses import dataclass

from aicity.settings import SettingsError, _only_keys

AI_MODES = ("claude_code", "local")
_MODEL_MAX = 80


@dataclass(frozen=True)
class CareerSettings:
    ai: str
    local_model: str | None
    reminder_day: int


def parse_career(t) -> CareerSettings:
    if not isinstance(t, dict):
        raise SettingsError("[career] must be a table.")
    _only_keys(t, "[career]", {"ai", "local_model", "reminder_day"})
    ai = t.get("ai", "claude_code")
    if ai not in AI_MODES:
        raise SettingsError(f"career.ai must be one of: {', '.join(AI_MODES)}.")
    model = t.get("local_model")
    if model is not None and (
        not isinstance(model, str) or not 1 <= len(model.strip()) <= _MODEL_MAX
    ):
        raise SettingsError(f"career.local_model must be text of 1 to {_MODEL_MAX} characters.")
    if ai == "local" and model is None:
        raise SettingsError('career.local_model is needed when career.ai = "local".')
    day = t.get("reminder_day", 1)
    if type(day) is not int or not 1 <= day <= 28:
        raise SettingsError("career.reminder_day must be a whole number from 1 to 28.")
    return CareerSettings(ai=ai, local_model=model.strip() if model else None, reminder_day=day)
