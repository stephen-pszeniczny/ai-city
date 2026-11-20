-- 014: Opportunity Office.
--
-- job_scan_runs: one row per Sunday scan (or "Scan now"). outcome_json lists each
--   source's result: [{"source": "company_a", "ok": true, "count": 12}, ...].
-- job_leads: one row per role, scanned or pasted. Only public posting text is stored
--   (title, company, location, pay text, a capped excerpt); never anything about Steve
--   beyond the status he set and the short resume label he typed when applying.
--   A scanned lead is identified by (origin = source id, external_id); a pasted lead
--   has origin 'pasted' and no external id. A repost found later points at the first
--   copy with merged_into and is never shown. batch_id / batch_rank say which scan
--   found it and where it ranked. follow_up_task_id links the Mission Control to-do
--   made 10 days after applying (PR 4).
-- job_lead_scores: one row per lead and profile. Scores aren't history: rescoring
--   replaces the row, so this table may be updated and its rows replaced.
-- job_platform_events: one row per change to a roster platform's stage, next step
--   or snooze. The latest row is the platform's state; none means the settings'
--   start_stage.
--
-- Pay is whole cents per pay_unit in pay_currency ('OTHER' = a currency we don't
-- convert). Formats: stamps are UTC, 2026-11-29T15:00:00Z; snoozed_until is a date.
-- Leads, scan runs and platform events are never deleted (leads roll off by status).

CREATE TABLE job_scan_runs (
    id           INTEGER PRIMARY KEY,
    started_at   TEXT NOT NULL
                 CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', started_at) IS started_at),
    finished_at  TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', finished_at) IS finished_at),
    outcome_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(outcome_json))
) STRICT;

CREATE TABLE job_leads (
    id                INTEGER PRIMARY KEY,
    origin            TEXT NOT NULL
                      CHECK (origin GLOB '[a-z]*' AND length(origin) BETWEEN 1 AND 31),
    external_id       TEXT CHECK (length(external_id) BETWEEN 1 AND 100),
    url               TEXT CHECK (url LIKE 'https://%' AND length(url) <= 500),
    title             TEXT NOT NULL
                      CHECK (length(title) BETWEEN 1 AND 200 AND title = trim(title)),
    company           TEXT NOT NULL
                      CHECK (length(company) BETWEEN 1 AND 120 AND company = trim(company)),
    location          TEXT NOT NULL DEFAULT '' CHECK (length(location) <= 200),
    remote            TEXT NOT NULL DEFAULT 'unknown' CHECK (remote IN ('yes', 'no', 'unknown')),
    canada_ok         TEXT NOT NULL DEFAULT 'unknown'
                      CHECK (canada_ok IN ('yes', 'no', 'unknown')),
    job_type          TEXT NOT NULL DEFAULT 'unknown'
                      CHECK (job_type IN ('contract', 'part_time', 'temporary', 'freelance',
                                          'full_time', 'unknown')),
    pay_low           INTEGER CHECK (pay_low >= 0),
    pay_high          INTEGER CHECK (pay_high >= 0),
    pay_currency      TEXT CHECK (pay_currency IN ('USD', 'CAD', 'OTHER')),
    pay_unit          TEXT NOT NULL DEFAULT 'unknown'
                      CHECK (pay_unit IN ('hour', 'year', 'unknown')),
    pay_text          TEXT NOT NULL DEFAULT '' CHECK (length(pay_text) <= 80),
    hours_low         INTEGER CHECK (hours_low BETWEEN 1 AND 80),
    hours_high        INTEGER CHECK (hours_high BETWEEN 1 AND 80),
    excerpt           TEXT NOT NULL DEFAULT '' CHECK (length(excerpt) <= 4000),
    first_seen        TEXT NOT NULL
                      CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', first_seen) IS first_seen),
    last_seen         TEXT NOT NULL
                      CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', last_seen) IS last_seen),
    closed_at         TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', closed_at) IS closed_at),
    status            TEXT NOT NULL DEFAULT 'new'
                      CHECK (status IN ('new', 'saved', 'skipped', 'applied', 'interview',
                                        'offer', 'rejected', 'filtered', 'expired')),
    status_at         TEXT NOT NULL
                      CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', status_at) IS status_at),
    applied_at        TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', applied_at) IS applied_at),
    resume_label      TEXT CHECK (length(resume_label) BETWEEN 1 AND 40
                                  AND resume_label = trim(resume_label)),
    batch_id          INTEGER REFERENCES job_scan_runs (id),
    batch_rank        INTEGER CHECK (batch_rank >= 1),
    merged_into       INTEGER REFERENCES job_leads (id),
    follow_up_task_id INTEGER REFERENCES tasks (id),
    CHECK (pay_low IS NULL OR pay_high IS NULL OR pay_low <= pay_high),
    CHECK (hours_low IS NULL OR hours_high IS NULL OR hours_low <= hours_high),
    -- Applying records when and with which resume; a lead past applied keeps both.
    CHECK (status NOT IN ('applied', 'interview', 'offer') OR applied_at IS NOT NULL),
    CHECK ((applied_at IS NULL) = (resume_label IS NULL)),
    -- Pasted leads have no external id; scanned ones always do.
    CHECK ((origin = 'pasted') = (external_id IS NULL)),
    UNIQUE (origin, external_id)
) STRICT;

CREATE INDEX job_leads_by_status ON job_leads (status, batch_id);

CREATE TABLE job_lead_scores (
    lead_id      INTEGER NOT NULL REFERENCES job_leads (id),
    profile_id   TEXT NOT NULL
                 CHECK (profile_id GLOB '[a-z]*' AND length(profile_id) BETWEEN 1 AND 31),
    score        INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
    verdict      TEXT NOT NULL CHECK (verdict IN ('strong', 'maybe', 'skip')),
    matched_json TEXT NOT NULL CHECK (json_valid(matched_json)),
    gaps_json    TEXT NOT NULL CHECK (json_valid(gaps_json)),
    flags_json   TEXT NOT NULL CHECK (json_valid(flags_json)),
    scored_at    TEXT NOT NULL
                 CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', scored_at) IS scored_at),
    PRIMARY KEY (lead_id, profile_id)
) STRICT;

CREATE TABLE job_platform_events (
    id            INTEGER PRIMARY KEY,
    platform_id   TEXT NOT NULL
                  CHECK (platform_id GLOB '[a-z]*' AND length(platform_id) BETWEEN 1 AND 31),
    stage         TEXT NOT NULL
                  CHECK (stage IN ('not_joined', 'applied', 'assessment', 'active', 'quiet')),
    next_step     TEXT NOT NULL DEFAULT ''
                  CHECK (length(next_step) <= 100 AND next_step = trim(next_step)),
    snoozed_until TEXT CHECK (date(snoozed_until) IS snoozed_until),
    changed_at    TEXT NOT NULL
                  CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', changed_at) IS changed_at)
) STRICT;

CREATE INDEX job_platform_events_latest ON job_platform_events (platform_id, id);

CREATE TRIGGER job_leads_no_delete
BEFORE DELETE ON job_leads
BEGIN
    SELECT RAISE(ABORT, 'Leads are never deleted; they roll off by status.');
END;

CREATE TRIGGER job_scan_runs_no_delete
BEFORE DELETE ON job_scan_runs
BEGIN
    SELECT RAISE(ABORT, 'Scan runs are never deleted.');
END;

CREATE TRIGGER job_platform_events_no_delete
BEFORE DELETE ON job_platform_events
BEGIN
    SELECT RAISE(ABORT, 'Platform history is never deleted.');
END;
