"""Opportunity Office: pasted leads, the inbox, lead statuses and platform stages.

The inbox, for one search profile:
Each list is ranked: leads with known hourly pay first, then by score, then by the
low end of the pay in US dollars per hour.
- New: status 'new' and either pasted, or from the newest scan within its top_n.
- Earlier: status 'new' from an older scan (no longer counted in the badge).
- More results: the newest scan past its top_n.
- Saved; Applied (applied, interview, offer); Closed (rejected, skipped, or a
  new or saved lead whose posting has closed).
Filtered, expired and merged (repost) leads are never shown.

A pasted role that matches an earlier one (same link, or the same company and
title within 30 days) joins it, filling only fields that were empty. Pasted
links are stored, never fetched. Platform state is the latest event row, or the
settings' start stage when there is none.

Stamps are UTC like 2026-11-29T15:00:00Z. The clock is passed in, so tests can use a fake one.
"""

import json
import sqlite3
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from aicity.db import with_transaction
from aicity.jobs_score import Posting, hourly_usd, score_posting
from aicity.jobs_settings import STAGES, JobProfile, JobsSettings
from aicity.jobs_text import Facts, Pay, normalise_company, normalise_title, parse_pay, read_facts
from aicity.tasks import utc_now

TITLE_MAX = 200
COMPANY_MAX = 120
LOCATION_MAX = 200
URL_MAX = 500
TEXT_MAX = 20_000
EXCERPT_MAX = 4000
LABEL_MAX = 40
NEXT_STEP_MAX = 100
SAME_ROLE_DAYS = 30
SNOOZE_DAYS = 28
STATUSES = ("new", "saved", "skipped", "applied", "interview", "offer", "rejected")
_NEXT = {
    "new": {"new", "saved", "skipped", "applied"},
    "saved": {"new", "saved", "skipped", "applied"},
    "skipped": {"new", "saved", "skipped", "applied"},
    "applied": {"interview", "offer", "rejected"},
    "interview": {"offer", "rejected"},
}
_STAMP_FORMAT = "%Y-%m-%dT%H:%M:%SZ"
_LEAD_COLUMNS = (
    "l.id, l.origin, l.url, l.title, l.company, l.location, l.remote, l.canada_ok, "
    "l.job_type, l.pay_low, l.pay_high, l.pay_currency, l.pay_unit, l.pay_text, l.status, "
    "l.applied_at, l.resume_label, s.score, s.verdict, s.matched_json, s.gaps_json, "
    "s.flags_json, l.closed_at, l.batch_id, l.batch_rank"
)


class JobsError(ValueError):
    """A change that isn't allowed as given. The message is safe to show."""


class JobsNotFound(LookupError):
    """No lead, profile or platform with that ID."""


class JobsConflict(Exception):
    """A status change the lead's current status doesn't allow."""


@dataclass(frozen=True)
class LeadView:
    id: int
    origin: str
    url: str | None
    title: str
    company: str
    location: str
    remote: str
    canada_ok: str
    job_type: str
    pay_low_usd: int | None  # US cents per hour
    pay_high_usd: int | None
    pay_text: str
    status: str
    applied_at: str | None
    resume_label: str | None
    score: int | None
    verdict: str | None
    matched: list[str]
    gaps: list[str]
    flags: list[str]
    closed: bool


@dataclass(frozen=True)
class Inbox:
    new: list[LeadView]
    earlier: list[LeadView]
    more: list[LeadView]
    saved: list[LeadView]
    applied: list[LeadView]
    closed: list[LeadView]


@dataclass(frozen=True)
class PlatformView:
    id: str
    name: str
    url: str
    stage: str
    next_step: str
    snoozed_until: str | None
    changed_at: str | None


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

    # --- Leads ------------------------------------------------------------

    def paste(
        self,
        *,
        url: str | None,
        title: str,
        company: str,
        location: str,
        text: str,
        profile_id: str,
    ) -> LeadView:
        profile = self._profile(profile_id)
        url = _optional_url(url)
        title = _required_text(title, "title", TITLE_MAX)
        company = _required_text(company, "company", COMPANY_MAX)
        location = (location or "").strip()
        if len(location) > LOCATION_MAX:
            raise JobsError(f"The location can be at most {LOCATION_MAX} characters.")
        text = text if isinstance(text, str) else ""
        if len(text) > TEXT_MAX:
            raise JobsError(f"The job text can be at most {TEXT_MAX} characters.")
        pay = parse_pay(text)
        facts = read_facts(title, location, text, profile.location_ok)
        excerpt = text.strip()[:EXCERPT_MAX]

        def work() -> int:
            stamp = self._stamp()
            existing = self._same_role(url, title, company)
            if existing is None:
                lead_id = self._insert_pasted(url, title, company, location, excerpt, pay, facts)
            else:
                lead_id = existing
                self._fill(lead_id, url, location, excerpt, pay, facts)
            self._conn.execute("UPDATE job_leads SET last_seen = ? WHERE id = ?", (stamp, lead_id))
            self._rescore(lead_id, profile)
            return lead_id

        lead_id = with_transaction(self._conn, work, immediate=True)
        return self._view(lead_id, profile.id)

    def list_leads(self, profile_id: str) -> Inbox:
        profile = self._profile(profile_id)
        latest = self._latest_batch()
        rows = self._conn.execute(
            f"SELECT {_LEAD_COLUMNS} FROM job_leads l "
            "JOIN job_lead_scores s ON s.lead_id = l.id AND s.profile_id = ? "
            "WHERE l.merged_into IS NULL AND l.status NOT IN ('filtered', 'expired') "
            "ORDER BY s.score DESC, coalesce(l.pay_low, l.pay_high, 0) DESC, l.id",
            (profile.id,),
        ).fetchall()
        lists: dict[str, list[LeadView]] = {
            k: [] for k in ("new", "earlier", "more", "saved", "applied", "closed")
        }
        for row in rows:
            lists[self._place(row, latest)].append(self._to_view(row))
        for views in lists.values():
            views.sort(key=_rank)
        return Inbox(**lists)

    def set_status(self, lead_id: int, status: str, resume_label: str | None = None) -> LeadView:
        if status not in STATUSES:
            raise JobsError(f"Status must be one of: {', '.join(STATUSES)}.")
        label = None
        if status == "applied":
            label = resume_label.strip() if isinstance(resume_label, str) else ""
            if not 1 <= len(label) <= LABEL_MAX:
                raise JobsError(f"Applying needs a resume label of 1 to {LABEL_MAX} characters.")

        def work() -> None:
            row = self._conn.execute(
                "SELECT status FROM job_leads WHERE id = ? AND merged_into IS NULL", (lead_id,)
            ).fetchone()
            if row is None:
                raise JobsNotFound(f"No lead with ID {lead_id}.")
            if status not in _NEXT.get(row[0], set()):
                raise JobsConflict(f"A lead that's {row[0]} can't be marked {status}.")
            stamp = self._stamp()
            if status == "applied":
                self._conn.execute(
                    "UPDATE job_leads SET status = ?, status_at = ?, applied_at = ?, "
                    "resume_label = ? WHERE id = ?",
                    (status, stamp, stamp, label, lead_id),
                )
            else:
                self._conn.execute(
                    "UPDATE job_leads SET status = ?, status_at = ? WHERE id = ?",
                    (status, stamp, lead_id),
                )

        with_transaction(self._conn, work, immediate=True)
        return self._view(lead_id, None)

    def skip_rest(self, profile_id: str) -> int:
        """Skip every lead in the New list. Returns how many."""

        def work() -> int:
            ids = [lead.id for lead in self.list_leads(profile_id).new]
            stamp = self._stamp()
            for lead_id in ids:
                self._conn.execute(
                    "UPDATE job_leads SET status = 'skipped', status_at = ? WHERE id = ?",
                    (stamp, lead_id),
                )
            return len(ids)

        return with_transaction(self._conn, work, immediate=True)

    def badge_counts(self, profile_id: str) -> dict[str, int]:
        return {"new": len(self.list_leads(profile_id).new)}

    # --- Platforms --------------------------------------------------------

    def platforms(self) -> list[PlatformView]:
        return [self._platform_view(p.id) for p in self._settings.platforms]

    def set_platform(
        self,
        platform_id: str,
        *,
        stage: str | None = None,
        next_step: str | None = None,
        snooze: bool = False,
    ) -> PlatformView:
        current = self._platform_view(platform_id)
        if stage is not None and stage not in STAGES:
            raise JobsError(f"Stage must be one of: {', '.join(STAGES)}.")
        if next_step is not None:
            if not isinstance(next_step, str) or len(next_step.strip()) > NEXT_STEP_MAX:
                raise JobsError(f"A next step can be at most {NEXT_STEP_MAX} characters.")
            next_step = next_step.strip()
        snoozed = (
            (self._today() + timedelta(days=SNOOZE_DAYS)).isoformat()
            if snooze
            else current.snoozed_until
        )

        def work() -> None:
            self._conn.execute(
                "INSERT INTO job_platform_events "
                "(platform_id, stage, next_step, snoozed_until, changed_at) VALUES (?, ?, ?, ?, ?)",
                (
                    platform_id,
                    stage if stage is not None else current.stage,
                    next_step if next_step is not None else current.next_step,
                    snoozed,
                    self._stamp(),
                ),
            )

        with_transaction(self._conn, work, immediate=True)
        return self._platform_view(platform_id)

    def nudges(self, limit: int = 2) -> list[PlatformView]:
        """Platforms with a next step and not snoozed, oldest change first."""
        today = self._today().isoformat()
        waiting = [
            p
            for p in self.platforms()
            if p.next_step and (p.snoozed_until is None or p.snoozed_until <= today)
        ]
        waiting.sort(key=lambda p: (p.changed_at or "", self._latest_event_id(p.id)))
        return waiting[:limit]

    # --- Helpers: leads ---------------------------------------------------

    def _profile(self, profile_id: str) -> JobProfile:
        for profile in self._settings.profiles:
            if profile.id == profile_id:
                return profile
        raise JobsNotFound("No search profile with that ID.")

    def _same_role(self, url: str | None, title: str, company: str) -> int | None:
        if url:
            row = self._conn.execute(
                "SELECT id FROM job_leads WHERE url = ? AND merged_into IS NULL ORDER BY id LIMIT 1",
                (url,),
            ).fetchone()
            if row:
                return row[0]
        since = (self._clock() - timedelta(days=SAME_ROLE_DAYS)).astimezone(UTC)
        want = (normalise_company(company), normalise_title(title))
        rows = self._conn.execute(
            "SELECT id, company, title FROM job_leads WHERE merged_into IS NULL "
            "AND first_seen >= ? ORDER BY id",
            (since.strftime(_STAMP_FORMAT),),
        ).fetchall()
        for lead_id, other_company, other_title in rows:
            if (normalise_company(other_company), normalise_title(other_title)) == want:
                return lead_id
        return None

    def _insert_pasted(self, url, title, company, location, excerpt, pay: Pay, facts: Facts):
        stamp = self._stamp()
        hours = facts.hours or (None, None)
        return self._conn.execute(
            "INSERT INTO job_leads (origin, url, title, company, location, remote, canada_ok, "
            "job_type, pay_low, pay_high, pay_currency, pay_unit, pay_text, hours_low, "
            "hours_high, excerpt, first_seen, last_seen, status, status_at) "
            "VALUES ('pasted', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)",
            (
                url,
                title,
                company,
                location,
                facts.remote,
                facts.canada_ok,
                facts.job_type,
                pay.low,
                pay.high,
                pay.currency,
                pay.unit,
                pay.text,
                hours[0],
                hours[1],
                excerpt,
                stamp,
                stamp,
                stamp,
            ),
        ).lastrowid

    def _fill(self, lead_id: int, url, location, excerpt, pay: Pay, facts: Facts) -> None:
        """Fill only the fields that are still empty or unknown."""
        hours = facts.hours or (None, None)
        self._conn.execute(
            "UPDATE job_leads SET "
            "url = coalesce(url, ?), "
            "location = CASE WHEN location = '' THEN ? ELSE location END, "
            "excerpt = CASE WHEN excerpt = '' THEN ? ELSE excerpt END, "
            "remote = CASE WHEN remote = 'unknown' THEN ? ELSE remote END, "
            "canada_ok = CASE WHEN canada_ok = 'unknown' THEN ? ELSE canada_ok END, "
            "job_type = CASE WHEN job_type = 'unknown' THEN ? ELSE job_type END, "
            "hours_low = CASE WHEN hours_low IS NULL THEN ? ELSE hours_low END, "
            "hours_high = CASE WHEN hours_low IS NULL THEN ? ELSE hours_high END WHERE id = ?",
            (
                url,
                location,
                excerpt,
                facts.remote,
                facts.canada_ok,
                facts.job_type,
                hours[0],
                hours[1],
                lead_id,
            ),
        )
        if pay.unit != "unknown":
            self._conn.execute(
                "UPDATE job_leads SET pay_low = ?, pay_high = ?, pay_currency = ?, pay_unit = ?, "
                "pay_text = ? WHERE id = ? AND pay_unit = 'unknown'",
                (pay.low, pay.high, pay.currency, pay.unit, pay.text, lead_id),
            )

    def _rescore(self, lead_id: int, profile: JobProfile) -> None:
        r = self._conn.execute(
            "SELECT title, company, location, excerpt, pay_low, pay_high, pay_currency, "
            "pay_unit, pay_text, remote, canada_ok, job_type, hours_low, hours_high "
            "FROM job_leads WHERE id = ?",
            (lead_id,),
        ).fetchone()
        hours = (r[12], r[13]) if r[12] is not None else None
        posting = Posting(
            title=r[0],
            company=r[1],
            location=r[2],
            text=r[3],
            pay=Pay(r[4], r[5], r[6], r[7], r[8]),
            facts=Facts(remote=r[9], canada_ok=r[10], job_type=r[11], hours=hours),
        )
        result = score_posting(posting, profile, self._rate)
        flags = result.flags + ((result.drop_reason,) if result.drop_reason else ())
        self._conn.execute(
            "INSERT OR REPLACE INTO job_lead_scores (lead_id, profile_id, score, verdict, "
            "matched_json, gaps_json, flags_json, scored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                lead_id,
                profile.id,
                result.score,
                result.verdict,
                json.dumps(list(result.matched)),
                json.dumps(list(result.gaps)),
                json.dumps(list(flags)),
                self._stamp(),
            ),
        )

    def _latest_batch(self) -> int | None:
        row = self._conn.execute("SELECT max(id) FROM job_scan_runs").fetchone()
        return row[0]

    def _place(self, row: tuple, latest: int | None) -> str:
        status, closed_at, batch_id, batch_rank = row[14], row[22], row[23], row[24]
        if status in ("applied", "interview", "offer"):
            return "applied"
        if status in ("rejected", "skipped") or closed_at is not None:
            return "closed"
        if status == "saved":
            return "saved"
        if row[1] == "pasted":
            return "new"
        if batch_id != latest:
            return "earlier"
        if batch_rank is not None and batch_rank <= self._settings.top_n:
            return "new"
        return "more"

    def _view(self, lead_id: int, profile_id: str | None) -> LeadView:
        if profile_id is None:
            profile_id = self._settings.profiles[0].id
        row = self._conn.execute(
            f"SELECT {_LEAD_COLUMNS} FROM job_leads l "
            "LEFT JOIN job_lead_scores s ON s.lead_id = l.id AND s.profile_id = ? "
            "WHERE l.id = ?",
            (profile_id, lead_id),
        ).fetchone()
        return self._to_view(row)

    def _to_view(self, r: tuple) -> LeadView:
        hourly = hourly_usd(Pay(r[9], r[10], r[11], r[12], r[13]), self._rate)
        low, high = hourly if hourly else (None, None)
        return LeadView(
            id=r[0],
            origin=r[1],
            url=r[2],
            title=r[3],
            company=r[4],
            location=r[5],
            remote=r[6],
            canada_ok=r[7],
            job_type=r[8],
            pay_low_usd=_cents(low),
            pay_high_usd=_cents(high),
            pay_text=r[13],
            status=r[14],
            applied_at=r[15],
            resume_label=r[16],
            score=r[17],
            verdict=r[18],
            matched=json.loads(r[19]) if r[19] else [],
            gaps=json.loads(r[20]) if r[20] else [],
            flags=json.loads(r[21]) if r[21] else [],
            closed=r[22] is not None,
        )

    # --- Helpers: platforms -----------------------------------------------

    def _platform_view(self, platform_id: str) -> PlatformView:
        platform = next((p for p in self._settings.platforms if p.id == platform_id), None)
        if platform is None:
            raise JobsNotFound("No platform with that ID.")
        row = self._conn.execute(
            "SELECT stage, next_step, snoozed_until, changed_at FROM job_platform_events "
            "WHERE platform_id = ? ORDER BY id DESC LIMIT 1",
            (platform_id,),
        ).fetchone()
        if row is None:
            return PlatformView(
                platform.id, platform.name, platform.url, platform.start_stage, "", None, None
            )
        return PlatformView(
            platform.id, platform.name, platform.url, row[0], row[1], row[2], row[3]
        )

    def _latest_event_id(self, platform_id: str) -> int:
        row = self._conn.execute(
            "SELECT max(id) FROM job_platform_events WHERE platform_id = ?", (platform_id,)
        ).fetchone()
        return row[0] or 0

    # --- Helpers: time ----------------------------------------------------

    def _now(self) -> datetime:
        now = self._clock()
        if now.tzinfo is None:
            raise ValueError("The clock must return a timezone-aware time.")
        return now

    def _stamp(self) -> str:
        return self._now().astimezone(UTC).strftime(_STAMP_FORMAT)

    def _today(self):
        return self._now().astimezone().date()


def _required_text(value, what: str, limit: int) -> str:
    text = value.strip() if isinstance(value, str) else ""
    if not 1 <= len(text) <= limit:
        raise JobsError(f"The {what} must be 1 to {limit} characters.")
    return text


def _optional_url(value) -> str | None:
    if value is None or (isinstance(value, str) and not value.strip()):
        return None
    url = value.strip() if isinstance(value, str) else ""
    if not url.startswith("https://") or len(url) > URL_MAX:
        raise JobsError(f"A link must start with https:// (up to {URL_MAX} characters).")
    return url


def _rank(lead: LeadView) -> tuple:
    """Known pay first, then score, then the hourly low end in US dollars."""
    pay = lead.pay_low_usd if lead.pay_low_usd is not None else lead.pay_high_usd
    return (pay is None, -(lead.score or 0), -(pay or 0), lead.id)


def _cents(dollars: Decimal | None) -> int | None:
    if dollars is None:
        return None
    return int((dollars * 100).quantize(Decimal(1), rounding=ROUND_HALF_UP))
