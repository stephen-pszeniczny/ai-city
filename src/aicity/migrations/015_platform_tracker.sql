-- 015: Opportunity Office becomes a platform tracker (redesign, 2026-11-22).
--
-- A real scan of public job lists found no suitable roles: paid AI-training work is
-- posted inside each platform behind a login. So the leads inbox, its scores and the
-- scan runs go. Those three tables were empty in the Personal database when this was
-- written (the owner approved removing them); Sample mode's made-up leads go with them.
--
-- platform_status_events: one row per change to a roster platform's status. The latest
--   row is its status; none means the settings' start_status. Carried over from
--   job_platform_events (not_joined -> not_applied, quiet -> paused); next steps and
--   snoozes are no longer used.
-- platform_checks: one row each time the owner checks a platform ("nothing" new, or
--   "found" something). The latest one sets when the next check is due.
-- platform_profiles: one row per platform with what the owner typed: a typical hourly
--   pay range, the resume version label submitted, domains claimed, assessments passed
--   and when the profile was last updated. Updated in place.
-- job_projects: the opportunity log. A generic title the owner writes (never anything
--   copied from the platform), hourly pay in USD or CAD, hours a week and a status.
--
-- Rows are never deleted. Stamps are UTC like 2026-11-29T15:00:00Z; dates YYYY-MM-DD.

DROP TABLE job_lead_scores;
DROP TABLE job_leads;
DROP TABLE job_scan_runs;

CREATE TABLE platform_status_events (
    id          INTEGER PRIMARY KEY,
    platform_id TEXT NOT NULL
                CHECK (platform_id GLOB '[a-z]*' AND length(platform_id) BETWEEN 1 AND 31),
    status      TEXT NOT NULL
                CHECK (status IN ('not_applied', 'applied', 'assessment', 'onboarding',
                                  'active', 'paused', 'rejected')),
    changed_at  TEXT NOT NULL
                CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', changed_at) IS changed_at)
) STRICT;

INSERT INTO platform_status_events (id, platform_id, status, changed_at)
SELECT id, platform_id,
       CASE stage WHEN 'not_joined' THEN 'not_applied' WHEN 'quiet' THEN 'paused' ELSE stage END,
       changed_at
FROM job_platform_events;

DROP TABLE job_platform_events;

CREATE INDEX platform_status_events_latest ON platform_status_events (platform_id, id);

CREATE TABLE platform_checks (
    id          INTEGER PRIMARY KEY,
    platform_id TEXT NOT NULL
                CHECK (platform_id GLOB '[a-z]*' AND length(platform_id) BETWEEN 1 AND 31),
    outcome     TEXT NOT NULL CHECK (outcome IN ('nothing', 'found')),
    checked_at  TEXT NOT NULL
                CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', checked_at) IS checked_at)
) STRICT;

CREATE INDEX platform_checks_latest ON platform_checks (platform_id, id);

CREATE TABLE platform_profiles (
    platform_id        TEXT PRIMARY KEY
                       CHECK (platform_id GLOB '[a-z]*' AND length(platform_id) BETWEEN 1 AND 31),
    pay_low_cents      INTEGER CHECK (pay_low_cents >= 0),
    pay_high_cents     INTEGER CHECK (pay_high_cents >= 0),
    pay_currency       TEXT CHECK (pay_currency IN ('USD', 'CAD')),
    resume_label       TEXT CHECK (length(resume_label) BETWEEN 1 AND 40
                                   AND resume_label = trim(resume_label)),
    domains_json       TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(domains_json)),
    assessments_json   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(assessments_json)),
    profile_updated_on TEXT CHECK (date(profile_updated_on) IS profile_updated_on),
    updated_at         TEXT NOT NULL
                       CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', updated_at) IS updated_at),
    CHECK (pay_low_cents IS NULL OR pay_high_cents IS NULL OR pay_low_cents <= pay_high_cents),
    -- A currency goes with a pay figure, and only with one.
    CHECK ((pay_currency IS NULL) = (pay_low_cents IS NULL AND pay_high_cents IS NULL))
) STRICT;

CREATE TABLE job_projects (
    id             INTEGER PRIMARY KEY,
    platform_id    TEXT NOT NULL
                   CHECK (platform_id GLOB '[a-z]*' AND length(platform_id) BETWEEN 1 AND 31),
    title          TEXT NOT NULL
                   CHECK (length(title) BETWEEN 1 AND 80 AND title = trim(title)),
    pay_cents      INTEGER CHECK (pay_cents >= 0),
    currency       TEXT CHECK (currency IN ('USD', 'CAD')),
    hours_per_week INTEGER CHECK (hours_per_week BETWEEN 1 AND 80),
    status         TEXT NOT NULL
                   CHECK (status IN ('found', 'applied', 'assessment', 'accepted',
                                     'rejected', 'active', 'ended')),
    found_on       TEXT NOT NULL CHECK (date(found_on) IS found_on),
    status_at      TEXT NOT NULL
                   CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', status_at) IS status_at),
    CHECK ((pay_cents IS NULL) = (currency IS NULL))
) STRICT;

CREATE TRIGGER platform_status_events_never_deleted
BEFORE DELETE ON platform_status_events
BEGIN
    SELECT RAISE(ABORT, 'Platform status history is never deleted.');
END;

CREATE TRIGGER platform_checks_never_deleted
BEFORE DELETE ON platform_checks
BEGIN
    SELECT RAISE(ABORT, 'Platform checks are never deleted.');
END;

CREATE TRIGGER platform_profiles_never_deleted
BEFORE DELETE ON platform_profiles
BEGIN
    SELECT RAISE(ABORT, 'Platform profiles are never deleted.');
END;

CREATE TRIGGER job_projects_never_deleted
BEFORE DELETE ON job_projects
BEGIN
    SELECT RAISE(ABORT, 'Logged projects are never deleted; they end or are rejected.');
END;
