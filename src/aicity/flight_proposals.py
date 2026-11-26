"""The shape of every Flight School proposal, checked before anything is saved.

A proposals file is a JSON list of {"kind": ..., "payload": {...}}. One bad item refuses
the whole file, with a message naming the item number and the field (never echoing the
owner's text). Kinds and their payloads:

    bullet          text, skills [names], competencies [ids]
    example         competency, situation, action, outcome (the regulator's limits)
    new_skill       name, category 1-7, level 1-5, related [names], competencies [ids]
    level_change    skill, to 1-5, evidence
    recommendation  skill, kind task|course, title, provider, url (https) or null, price, free
    resume_change   section, action add|replace|remove, item (id, null for add), text
"""

from aicity.competencies import LIMITS, competency

KINDS = ("bullet", "example", "new_skill", "level_change", "recommendation", "resume_change")
_NAME_MAX = 60
_LIST_MAX = 20


class FlightError(ValueError):
    """Bad input; the message says what to fix."""


class FlightNotFound(LookupError):
    """No month, proposal, skill or recommendation with that id."""


class FlightConflict(Exception):
    """The change isn't allowed in the current state."""


def validate_proposals(data: object) -> list[dict]:
    if not isinstance(data, list):
        raise FlightError("A proposals file must be a list of proposals.")
    if not data:
        raise FlightError("The file has no proposals.")
    out = []
    for n, item in enumerate(data, start=1):
        if not isinstance(item, dict) or set(item) != {"kind", "payload"}:
            raise FlightError(f"Proposal item {n} needs exactly 'kind' and 'payload'.")
        try:
            payload = validate_payload(item["kind"], item["payload"])
        except FlightError as exc:
            raise FlightError(f"Proposal item {n}: {exc}") from None
        out.append({"kind": item["kind"], "payload": payload})
    return out


def validate_payload(kind: str, payload: object) -> dict:
    if kind not in KINDS:
        raise FlightError(f"kind must be one of: {', '.join(KINDS)}.")
    if not isinstance(payload, dict):
        raise FlightError("payload must be an object.")
    return _CHECKS[kind](payload)


# --- Per kind ------------------------------------------------------------------


def _bullet(p: dict) -> dict:
    _fields(p, {"text", "skills", "competencies"})
    return {
        "text": _text(p, "text", 300),
        "skills": _names(p, "skills"),
        "competencies": _competencies(p, "competencies"),
    }


def _example(p: dict) -> dict:
    _fields(p, {"competency", "situation", "action", "outcome"})
    _competency_id(p["competency"], "competency")
    return {
        "competency": p["competency"],
        **{part: _text(p, part, LIMITS[part]) for part in ("situation", "action", "outcome")},
    }


def _new_skill(p: dict) -> dict:
    _fields(p, {"name", "category", "level", "related", "competencies"})
    return {
        "name": _text(p, "name", _NAME_MAX),
        "category": _whole(p, "category", 1, 7),
        "level": _whole(p, "level", 1, 5),
        "related": _names(p, "related"),
        "competencies": _competencies(p, "competencies"),
    }


def _level_change(p: dict) -> dict:
    _fields(p, {"skill", "to", "evidence"})
    return {
        "skill": _text(p, "skill", _NAME_MAX),
        "to": _whole(p, "to", 1, 5),
        "evidence": _text(p, "evidence", 300, allow_empty=True),
    }


def _recommendation(p: dict) -> dict:
    _fields(p, {"skill", "kind", "title", "provider", "url", "price", "free"})
    if p["kind"] not in ("task", "course"):
        raise FlightError("kind must be 'task' or 'course'.")
    url = p["url"]
    if url is not None and (
        not isinstance(url, str) or not url.startswith("https://") or len(url) > 500
    ):
        raise FlightError("url must start with https:// (or be null).")
    if not isinstance(p["free"], bool):
        raise FlightError("free must be true or false.")
    return {
        "skill": _text(p, "skill", _NAME_MAX),
        "kind": p["kind"],
        "title": _text(p, "title", 120),
        "provider": _text(p, "provider", 60, allow_empty=True),
        "url": url,
        "price": _text(p, "price", 40, allow_empty=True),
        "free": p["free"],
    }


def _resume_change(p: dict) -> dict:
    _fields(p, {"section", "action", "item", "text"})
    action = p["action"]
    if action not in ("add", "replace", "remove"):
        raise FlightError("action must be add, replace or remove.")
    item = p["item"]
    if action == "add" and item is not None:
        raise FlightError("item must be null when adding.")
    if action != "add" and (type(item) is not int or item < 1):
        raise FlightError("item must be the id of the resume item to change.")
    return {
        "section": _text(p, "section", _NAME_MAX),
        "action": action,
        "item": item,
        "text": _text(p, "text", 300, allow_empty=action == "remove"),
    }


_CHECKS = {
    "bullet": _bullet,
    "example": _example,
    "new_skill": _new_skill,
    "level_change": _level_change,
    "recommendation": _recommendation,
    "resume_change": _resume_change,
}


# --- Helpers -------------------------------------------------------------------


def _fields(p: dict, wanted: set[str]) -> None:
    extra = sorted(set(p) - wanted)
    if extra:
        raise FlightError(f"unknown field(s): {', '.join(extra)}.")
    missing = sorted(wanted - set(p))
    if missing:
        raise FlightError(f"missing field(s): {', '.join(missing)}.")


def _text(p: dict, key: str, limit: int, *, allow_empty: bool = False) -> str:
    value = p[key]
    if not isinstance(value, str):
        raise FlightError(f"{key} must be text.")
    value = value.strip()
    if (not value and not allow_empty) or len(value) > limit:
        raise FlightError(f"{key} needs {0 if allow_empty else 1} to {limit} characters.")
    return value


def _whole(p: dict, key: str, low: int, high: int) -> int:
    value = p[key]
    if type(value) is not int or not low <= value <= high:
        raise FlightError(f"{key} must be a whole number from {low} to {high}.")
    return value


def _names(p: dict, key: str) -> list[str]:
    value = p[key]
    if (
        not isinstance(value, list)
        or len(value) > _LIST_MAX
        or not all(isinstance(v, str) and 1 <= len(v.strip()) <= _NAME_MAX for v in value)
    ):
        raise FlightError(f"{key} must be a list of up to {_LIST_MAX} names.")
    return [v.strip() for v in value]


def _competency_id(value: object, key: str) -> None:
    try:
        competency(value)  # type: ignore[arg-type]
    except (KeyError, TypeError):
        raise FlightError(f"{key} must be one of the 34 competency ids, like 2.1.") from None


def _competencies(p: dict, key: str) -> list[str]:
    value = p[key]
    if not isinstance(value, list) or len(value) > _LIST_MAX:
        raise FlightError(f"{key} must be a list of competency ids.")
    for v in value:
        _competency_id(v, key)
    return list(value)
