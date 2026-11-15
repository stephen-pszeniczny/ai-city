"""Reads and checks the settings file in the private data folder.

The file is plain TOML (see settings.example.toml in the repo). Every value
is checked when it's loaded, so a typo shows up as a clear message at start
instead of a strange bug later.

Error messages name the setting that's wrong but never repeat its value,
because values can be personal (an income goal, a home location).
"""

import re
import tomllib
from dataclasses import dataclass
from datetime import time
from decimal import Decimal, InvalidOperation
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from aicity import config

# Generic building IDs used by the code. Display names come from settings.
BUILDING_IDS = (
    "planner",
    "finance",
    "jobs",
    "career",
    "mail",
    "relationships",
    "projects",
    "gym",
    "library",
)

SETTINGS_SUBDIR = "settings"
SETTINGS_FILENAME = "settings.toml"


class SettingsError(Exception):
    """The settings file is missing or has a problem. The message says where."""


@dataclass(frozen=True)
class Location:
    name: str
    latitude: float
    longitude: float
    timezone: str


@dataclass(frozen=True)
class Goals:
    monthly_income_cents: int
    currency: str


@dataclass(frozen=True)
class TaskDefaults:
    stale_after_days: int
    reminder_time: time


@dataclass(frozen=True)
class IncomeSettings:
    tax_set_aside_percent: Decimal
    tax_set_aside_is_placeholder: bool


@dataclass(frozen=True)
class Settings:
    buildings: dict[str, str]
    location: Location
    goals: Goals
    tasks: TaskDefaults
    income: IncomeSettings


def settings_path() -> Path:
    """Where the real settings file lives: <data folder>/settings/settings.toml."""
    return config.data_dir() / SETTINGS_SUBDIR / SETTINGS_FILENAME


def load_settings(path: Path | None = None) -> Settings:
    """Read and check the settings file. Raises SettingsError on any problem."""
    path = path or settings_path()
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise SettingsError(
            f"Settings file not found at {path}. Run scripts/init_data_dir.py to create it."
        ) from None

    try:
        data = tomllib.loads(text)
    except tomllib.TOMLDecodeError as exc:
        # The parser's message gives line and column; it doesn't quote values.
        raise SettingsError(f"Settings file isn't valid TOML: {exc}") from None

    return parse_settings(data)


def parse_settings(data: dict) -> Settings:
    """Check already-parsed settings data and turn it into a Settings object."""
    _only_keys(data, "settings file", {"buildings", "location", "goals", "tasks", "income"})
    return Settings(
        buildings=_buildings(_table(data, "buildings")),
        location=_location(_table(data, "location")),
        goals=_goals(_table(data, "goals")),
        tasks=_tasks(_table(data, "tasks")),
        income=_income(_table(data, "income")),
    )


# --- Sections --------------------------------------------------------------


def _buildings(t: dict) -> dict[str, str]:
    _exact_keys(t, "buildings", set(BUILDING_IDS))
    return {bid: _text(t, "buildings", bid) for bid in BUILDING_IDS}


def _location(t: dict) -> Location:
    _exact_keys(t, "location", {"name", "latitude", "longitude", "timezone"})
    tz = _text(t, "location", "timezone")
    try:
        ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        raise SettingsError("location.timezone isn't a known time zone name.") from None
    return Location(
        name=_text(t, "location", "name"),
        latitude=_number(t, "location", "latitude", -90, 90),
        longitude=_number(t, "location", "longitude", -180, 180),
        timezone=tz,
    )


def _goals(t: dict) -> Goals:
    _exact_keys(t, "goals", {"monthly_income", "currency"})
    currency = _text(t, "goals", "currency")
    if not re.fullmatch(r"[A-Z]{3}", currency):
        raise SettingsError("goals.currency must be a 3-letter code like CAD or USD.")
    return Goals(
        monthly_income_cents=_money_cents(t, "goals", "monthly_income"),
        currency=currency,
    )


def _tasks(t: dict) -> TaskDefaults:
    _exact_keys(t, "tasks", {"stale_after_days", "reminder_time"})
    days = t["stale_after_days"]
    if type(days) is not int or not 1 <= days <= 365:
        raise SettingsError("tasks.stale_after_days must be a whole number from 1 to 365.")
    raw_time = _text(t, "tasks", "reminder_time")
    match = re.fullmatch(r"([01]\d|2[0-3]):([0-5]\d)", raw_time)
    if not match:
        raise SettingsError('tasks.reminder_time must be a 24-hour time like "09:00".')
    return TaskDefaults(
        stale_after_days=days,
        reminder_time=time(int(match[1]), int(match[2])),
    )


def _income(t: dict) -> IncomeSettings:
    _exact_keys(t, "income", {"tax_set_aside_percent", "tax_set_aside_is_placeholder"})
    percent = _decimal(t, "income", "tax_set_aside_percent")
    if not Decimal(0) <= percent <= Decimal(100):
        raise SettingsError("income.tax_set_aside_percent must be from 0 to 100.")
    flag = t["tax_set_aside_is_placeholder"]
    if type(flag) is not bool:
        raise SettingsError("income.tax_set_aside_is_placeholder must be true or false.")
    return IncomeSettings(tax_set_aside_percent=percent, tax_set_aside_is_placeholder=flag)


# --- Small checking helpers ------------------------------------------------


def _table(data: dict, name: str) -> dict:
    value = data.get(name)
    if not isinstance(value, dict):
        raise SettingsError(f"Missing [{name}] section.")
    return value


def _only_keys(t: dict, where: str, allowed: set[str]) -> None:
    unknown = sorted(set(t) - allowed)
    if unknown:
        raise SettingsError(f"Unknown setting(s) in {where}: {', '.join(unknown)}. Check spelling.")


def _exact_keys(t: dict, section: str, required: set[str]) -> None:
    _only_keys(t, f"[{section}]", required)
    missing = sorted(required - set(t))
    if missing:
        raise SettingsError(f"Missing setting(s) in [{section}]: {', '.join(missing)}.")


def _text(t: dict, section: str, key: str) -> str:
    value = t[key]
    if not isinstance(value, str) or not value.strip():
        raise SettingsError(f"{section}.{key} must be non-empty text in quotes.")
    return value.strip()


def _number(t: dict, section: str, key: str, low: float, high: float) -> float:
    value = t[key]
    if type(value) not in (int, float) or not low <= value <= high:
        raise SettingsError(f"{section}.{key} must be a number from {low} to {high}.")
    return float(value)


def _decimal(t: dict, section: str, key: str) -> Decimal:
    value = t[key]
    if not isinstance(value, str):
        raise SettingsError(f'{section}.{key} must be written as text in quotes, like "20".')
    try:
        result = Decimal(value.strip())
    except InvalidOperation:
        raise SettingsError(f"{section}.{key} isn't a valid number.") from None
    if not result.is_finite():
        raise SettingsError(f"{section}.{key} isn't a valid number.")
    return result


def _money_cents(t: dict, section: str, key: str) -> int:
    """Money as text ("1234.50") to whole cents, refusing anything ambiguous."""
    if not isinstance(t[key], str) or not re.fullmatch(r"\d+(\.\d{1,2})?", t[key].strip()):
        raise SettingsError(
            f'{section}.{key} must be an amount in quotes with up to 2 decimals, like "1234.50".'
        )
    return int(Decimal(t[key].strip()) * 100)
