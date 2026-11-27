"""Opportunity Office: the platform roster, check rounds, profiles and the opportunity log.

A platform's status is its latest status event, or the settings' start_status when it
has none. Each status (except not_applied and rejected) has a check interval in days
(settings check_days). The next check is due that many days after the later of its
last check and its last status change; a platform with no history is due today.

A profile refresh is due for a platform that has applied or gone further (not
rejected) when its profile date is missing or 90+ days old, or its resume label
differs from the master resume label.

Logged projects move forward along found -> applied -> assessment -> accepted ->
active -> ended (skipping is fine), or to rejected before they're active. Rejected
and ended are final. Pay is one hourly figure in USD or CAD, converted with the
Bank of Canada rate (CAD per USD) when known; below the floor is flagged only when
the US-dollar figure is known.

Dates are the Mac's local date; stamps are UTC like 2026-11-29T15:00:00Z. Platforms
removed from settings are not shown; their projects show the platform id as its name.
"""

import json
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from aicity.db import with_transaction
from aicity.jobs_settings import STATUSES, JobPlatform, JobsSettings
from aicity.tasks import utc_now

PROJECT_STATUSES = ("found", "applied", "assessment", "accepted", "rejected", "active", "ended")
_FORWARD = ("found", "applied", "assessment", "accepted", "active", "ended")
_FINAL = ("rejected", "ended")
_CHECK_OUTCOMES = ("nothing", "found")
REFRESH_DAYS = 90
TITLE_MAX = 80
LABEL_MAX = 40
TAG_MAX = 40
TAGS_MAX = 20
HOURS_MAX = 80
_CURRENCIES = ("USD", "CAD")
_STAMP_FORMAT = "%Y-%m-%dT%H:%M:%SZ"
_PROFILE_FIELDS = {
    "pay_low_cents",
    "pay_high_cents",
    "pay_currency",
    "resume_label",
    "domains",
    "assessments",
    "profile_updated_on",
}
_PROJECT_FIELDS = {"title", "pay_cents", "currency", "hours_per_week"}
_PROJECT_COLUMNS = (
    "id, platform_id, title, pay_cents, currency, hours_per_week, status, found_on, status_at"
)


class JobsError(ValueError):
    """Bad input; the message says what to fix."""


class JobsNotFound(LookupError):
    """No platform or project with that ID."""


class JobsConflict(Exception):
    """The change isn't allowed from the current status."""


@dataclass(frozen=True)
class PlatformCard:
    id: str
    name: str
    url: str
    status: str
    status_at: str | None
    last_checked_at: str | None
    next_check_on: str | None
    due: bool
    pay_low_cents: int | None
    pay_high_cents: int | None
    pay_currency: str | None
    resume_label: str | None
    domains: list[str]
    assessments: list[str]
    profile_updated_on: str | None
    refresh_due: bool


@dataclass(frozen=True)
class ProjectView:
    id: int
    platform_id: str
    platform_name: str
    title: str
    pay_cents: int | None
    currency: str | None
    pay_usd_cents: int | None
    pay_cad_cents: int | None
    hours_per_week: int | None
    status: str
    found_on: str
    status_at: str
    flags: list[str]


class JobsStore:
    """All Opportunity Office reads and writes for one open database."""

    def __init__(
        self,
        conn: sqlite3.Connection,
        settings: JobsSettings,
        *,
        clock: Callable[[], datetime] = utc_now,
        usd_rate: Decimal | None = None,
    ) -> None:
        self._conn = conn
        self._settings = settings
        self._clock = clock
        self._rate = usd_rate

    # --- Roster -----------------------------------------------------------------

    def platforms(self) -> list[PlatformCard]:
        return [self._card(p) for p in self._settings.platforms]

    def due(self) -> list[PlatformCard]:
        return [c for c in self.platforms() if c.due]

    def due_count(self) -> int:
        return len(self.due())

    def set_status(self, platform_id: str, status: str) -> PlatformCard:
        platform = self._platform(platform_id)
        if status not in STATUSES:
            raise JobsError(f"Status must be one of: {', '.join(STATUSES)}.")
        self._write(
            "INSERT INTO platform_status_events (platform_id, status, changed_at) VALUES (?, ?, ?)",
            (platform_id, status, self._stamp()),
        )
        return self._card(platform)

    def record_check(self, platform_id: str, outcome: str) -> PlatformCard:
        platform = self._platform(platform_id)
        if outcome not in _CHECK_OUTCOMES:
            raise JobsError("A check is either 'nothing' or 'found'.")
        self._write(
            "INSERT INTO platform_checks (platform_id, outcome, checked_at) VALUES (?, ?, ?)",
            (platform_id, outcome, self._stamp()),
        )
        return self._card(platform)

    def set_profile(self, platform_id: str, **fields) -> PlatformCard:
        platform = self._platform(platform_id)
        unknown = set(fields) - _PROFILE_FIELDS
        if unknown:
            raise JobsError(f"Unknown profile field(s): {', '.join(sorted(unknown))}.")
        row = _checked_profile({**self._profile(platform_id), **fields})
        self._write(
            "INSERT INTO platform_profiles (platform_id, pay_low_cents, pay_high_cents, "
            "pay_currency, resume_label, domains_json, assessments_json, profile_updated_on, "
            "updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT (platform_id) DO UPDATE SET pay_low_cents = excluded.pay_low_cents, "
            "pay_high_cents = excluded.pay_high_cents, pay_currency = excluded.pay_currency, "
            "resume_label = excluded.resume_label, domains_json = excluded.domains_json, "
            "assessments_json = excluded.assessments_json, "
            "profile_updated_on = excluded.profile_updated_on, updated_at = excluded.updated_at",
            (platform_id, *row, self._stamp()),
        )
        return self._card(platform)

    # --- Opportunity log --------------------------------------------------------

    def projects(self) -> list[ProjectView]:
        rows = self._conn.execute(f"SELECT {_PROJECT_COLUMNS} FROM job_projects").fetchall()
        views = [self._project_view(r) for r in rows]
        return sorted(
            views, key=lambda v: (v.status in _FINAL, PROJECT_STATUSES.index(v.status), -v.id)
        )

    def add_project(
        self,
        *,
        platform_id: str,
        title: str,
        pay_cents: int | None,
        currency: str | None,
        hours_per_week: int | None,
    ) -> ProjectView:
        self._platform(platform_id)
        values = _checked_project(
            {
                "title": title,
                "pay_cents": pay_cents,
                "currency": currency,
                "hours_per_week": hours_per_week,
            }
        )
        stamp = self._stamp()

        def work() -> int:
            new_id = self._conn.execute(
                "INSERT INTO job_projects (platform_id, title, pay_cents, currency, "
                "hours_per_week, status, found_on, status_at) "
                "VALUES (?, ?, ?, ?, ?, 'found', ?, ?)",
                (platform_id, *values, self._today().isoformat(), stamp),
            ).lastrowid
            self._record_project_event(new_id, "found", stamp)
            return new_id

        project_id = with_transaction(self._conn, work, immediate=True)
        return self._project(project_id)

    def edit_project(self, project_id: int, **fields) -> ProjectView:
        unknown = set(fields) - _PROJECT_FIELDS
        if unknown:
            raise JobsError(f"Unknown project field(s): {', '.join(sorted(unknown))}.")
        current = self._project(project_id)
        values = _checked_project(
            {
                "title": current.title,
                "pay_cents": current.pay_cents,
                "currency": current.currency,
                "hours_per_week": current.hours_per_week,
                **fields,
            }
        )
        self._write(
            "UPDATE job_projects SET title = ?, pay_cents = ?, currency = ?, hours_per_week = ? "
            "WHERE id = ?",
            (*values, project_id),
        )
        return self._project(project_id)

    def set_project_status(self, project_id: int, status: str) -> ProjectView:
        if status not in PROJECT_STATUSES:
            raise JobsError(f"Status must be one of: {', '.join(PROJECT_STATUSES)}.")
        stamp = self._stamp()

        def work() -> None:
            # Read and check under the write lock, so two moves can't both pass.
            current = self._project(project_id)
            if not _can_move(current.status, status):
                raise JobsConflict(f"A project that is {current.status} can't move to {status}.")
            self._conn.execute(
                "UPDATE job_projects SET status = ?, status_at = ? WHERE id = ?",
                (status, stamp, project_id),
            )
            self._record_project_event(project_id, status, stamp)

        with_transaction(self._conn, work, immediate=True)
        return self._project(project_id)

    def active_platform_names(self) -> list[str]:
        rows = self._conn.execute(
            "SELECT DISTINCT platform_id FROM job_projects WHERE status = 'active'"
        ).fetchall()
        active = {r[0] for r in rows}
        return [p.name for p in self._settings.platforms if p.id in active]

    # --- Helpers: platforms -----------------------------------------------------

    def _platform(self, platform_id: str) -> JobPlatform:
        for platform in self._settings.platforms:
            if platform.id == platform_id:
                return platform
        raise JobsNotFound("No platform with that ID.")

    def _card(self, platform: JobPlatform) -> PlatformCard:
        status_row = self._conn.execute(
            "SELECT status, changed_at FROM platform_status_events WHERE platform_id = ? "
            "ORDER BY id DESC LIMIT 1",
            (platform.id,),
        ).fetchone()
        status, status_at = status_row if status_row else (platform.start_status, None)
        checked = self._conn.execute(
            "SELECT max(checked_at) FROM platform_checks WHERE platform_id = ?", (platform.id,)
        ).fetchone()[0]
        today = self._today()
        next_on = self._next_check_on(status, status_at, checked)
        profile = self._profile(platform.id)
        return PlatformCard(
            id=platform.id,
            name=platform.name,
            url=platform.url,
            status=status,
            status_at=status_at,
            last_checked_at=checked,
            next_check_on=None if next_on is None else next_on.isoformat(),
            due=next_on is not None and today >= next_on,
            pay_low_cents=profile["pay_low_cents"],
            pay_high_cents=profile["pay_high_cents"],
            pay_currency=profile["pay_currency"],
            resume_label=profile["resume_label"],
            domains=profile["domains"],
            assessments=profile["assessments"],
            profile_updated_on=profile["profile_updated_on"],
            refresh_due=self._refresh_due(status, profile, today),
        )

    def _next_check_on(
        self, status: str, status_at: str | None, checked: str | None
    ) -> date | None:
        days = self._settings.check_days.get(status)
        if days is None:
            return None
        stamps = [s for s in (status_at, checked) if s is not None]
        if not stamps:
            return self._today()
        return _local_date(max(stamps)) + timedelta(days=days)

    def _refresh_due(self, status: str, profile: dict, today: date) -> bool:
        if status in ("not_applied", "rejected"):
            return False
        updated = profile["profile_updated_on"]
        if updated is None or (today - date.fromisoformat(updated)).days >= REFRESH_DAYS:
            return True
        master = self._settings.master_resume_label
        return master is not None and profile["resume_label"] != master

    def _profile(self, platform_id: str) -> dict:
        row = self._conn.execute(
            "SELECT pay_low_cents, pay_high_cents, pay_currency, resume_label, domains_json, "
            "assessments_json, profile_updated_on FROM platform_profiles WHERE platform_id = ?",
            (platform_id,),
        ).fetchone()
        if row is None:
            row = (None, None, None, None, "[]", "[]", None)
        return {
            "pay_low_cents": row[0],
            "pay_high_cents": row[1],
            "pay_currency": row[2],
            "resume_label": row[3],
            "domains": json.loads(row[4]),
            "assessments": json.loads(row[5]),
            "profile_updated_on": row[6],
        }

    # --- Helpers: projects ------------------------------------------------------

    def _project(self, project_id: int) -> ProjectView:
        row = self._conn.execute(
            f"SELECT {_PROJECT_COLUMNS} FROM job_projects WHERE id = ?", (project_id,)
        ).fetchone()
        if row is None:
            raise JobsNotFound("No project with that ID.")
        return self._project_view(row)

    def _record_project_event(self, project_id: int, status: str, stamp: str) -> None:
        """The permanent record of the stages a project reached (Belt XP counts them)."""
        self._conn.execute(
            "INSERT INTO job_project_events (project_id, status, at) VALUES (?, ?, ?)",
            (project_id, status, stamp),
        )

    def _project_view(self, r: tuple) -> ProjectView:
        names = {p.id: p.name for p in self._settings.platforms}
        pay, currency = r[3], r[4]
        usd = cad = None
        if pay is not None and currency == "USD":
            usd = pay
            cad = _round(Decimal(pay) * self._rate) if self._rate else None
        elif pay is not None:
            cad = pay
            usd = _round(Decimal(pay) / self._rate) if self._rate else None
        below = usd is not None and usd < self._settings.pay_floor_usd * 100
        return ProjectView(
            id=r[0],
            platform_id=r[1],
            platform_name=names.get(r[1], r[1]),
            title=r[2],
            pay_cents=pay,
            currency=currency,
            pay_usd_cents=usd,
            pay_cad_cents=cad,
            hours_per_week=r[5],
            status=r[6],
            found_on=r[7],
            status_at=r[8],
            flags=["below_floor"] if below else [],
        )

    # --- Helpers: writing and time ----------------------------------------------

    def _write(self, sql: str, params: tuple) -> int:
        return with_transaction(
            self._conn, lambda: self._conn.execute(sql, params).lastrowid, immediate=True
        )

    def _now(self) -> datetime:
        now = self._clock()
        if now.tzinfo is None:
            raise ValueError("The clock must return a timezone-aware time.")
        return now

    def _stamp(self) -> str:
        return self._now().astimezone(UTC).strftime(_STAMP_FORMAT)

    def _today(self) -> date:
        return self._now().astimezone().date()


def _can_move(current: str, target: str) -> bool:
    if current in _FINAL:
        return False
    if target == "rejected":
        return current in ("found", "applied", "assessment", "accepted")
    return _FORWARD.index(target) > _FORWARD.index(current)


def _checked_project(v: dict) -> tuple:
    title = v["title"].strip() if isinstance(v["title"], str) else ""
    if not 1 <= len(title) <= TITLE_MAX:
        raise JobsError(f"The title needs 1 to {TITLE_MAX} characters.")
    pay, currency = v["pay_cents"], v["currency"]
    if (pay is None) != (currency is None):
        raise JobsError("Pay and its currency go together: give both or neither.")
    if pay is not None and (type(pay) is not int or pay < 0):
        raise JobsError("Pay must be a whole number of cents, 0 or more.")
    if currency is not None and currency not in _CURRENCIES:
        raise JobsError("Currency must be USD or CAD.")
    hours = v["hours_per_week"]
    if hours is not None and (type(hours) is not int or not 1 <= hours <= HOURS_MAX):
        raise JobsError(f"Hours a week must be a whole number from 1 to {HOURS_MAX}.")
    return title, pay, currency, hours


def _checked_profile(v: dict) -> tuple:
    low, high, currency = v["pay_low_cents"], v["pay_high_cents"], v["pay_currency"]
    for amount in (low, high):
        if amount is not None and (type(amount) is not int or amount < 0):
            raise JobsError("Pay amounts must be whole numbers of cents, 0 or more.")
    if low is not None and high is not None and low > high:
        raise JobsError("The low end of the pay range can't be above the high end.")
    if (currency is None) != (low is None and high is None):
        raise JobsError("A pay range and its currency go together.")
    if currency is not None and currency not in _CURRENCIES:
        raise JobsError("Currency must be USD or CAD.")
    label = v["resume_label"]
    if label is not None:
        label = label.strip() if isinstance(label, str) else ""
        if not 1 <= len(label) <= LABEL_MAX:
            raise JobsError(f"The resume label needs 1 to {LABEL_MAX} characters.")
    updated = v["profile_updated_on"]
    if updated is not None:
        try:
            date.fromisoformat(updated)
        except (TypeError, ValueError):
            raise JobsError("The profile date must look like 2026-11-29.") from None
    return (
        low,
        high,
        currency,
        label,
        json.dumps(_tags(v["domains"], "domains")),
        json.dumps(_tags(v["assessments"], "assessments")),
        updated,
    )


def _tags(values, what: str) -> list[str]:
    if (
        not isinstance(values, list)
        or len(values) > TAGS_MAX
        or not all(isinstance(t, str) and 1 <= len(t.strip()) <= TAG_MAX for t in values)
    ):
        raise JobsError(
            f"{what.capitalize()} must be a list of up to {TAGS_MAX} items "
            f"of 1 to {TAG_MAX} characters."
        )
    return [t.strip() for t in values]


def _local_date(stamp: str) -> date:
    return datetime.strptime(stamp, _STAMP_FORMAT).replace(tzinfo=UTC).astimezone().date()


def _round(value: Decimal) -> int:
    return int(value.quantize(Decimal(1), rounding=ROUND_HALF_UP))
