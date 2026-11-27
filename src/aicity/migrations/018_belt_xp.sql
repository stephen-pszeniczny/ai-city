-- 018: Belt XP. XP is worked out on the fly from what's already recorded; these
-- tables add the few facts that weren't being kept.
--
-- platform_profile_refreshes: one row each time a platform profile's date moves.
--   platform_profiles only holds the latest date, so each refresh is kept here.
--   Starts with one row per profile that already has a date.
-- job_project_events: one row each time a logged project is added or changes status,
--   so a rejected project keeps the stages it reached. Starts with each existing
--   project's current status (earlier stages weren't recorded).
-- routine_finishes: a row is added once that day's routine is fully ticked, so later
--   settings changes never change past XP. Not history: only a real untick that
--   leaves the routine incomplete removes the row.
-- xp_seen: the last level shown and upgrade celebrated, per building ID or 'belt'.
--
-- Stamps are UTC like 2026-11-29T15:00:00Z; dates YYYY-MM-DD.

CREATE TABLE platform_profile_refreshes (
    id           INTEGER PRIMARY KEY,
    platform_id  TEXT NOT NULL
                 CHECK (platform_id GLOB '[a-z]*' AND length(platform_id) BETWEEN 1 AND 31),
    refreshed_on TEXT NOT NULL CHECK (date(refreshed_on) IS refreshed_on),
    created_at   TEXT NOT NULL
                 CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', created_at) IS created_at)
) STRICT;

INSERT INTO platform_profile_refreshes (platform_id, refreshed_on, created_at)
SELECT platform_id, profile_updated_on, updated_at
FROM platform_profiles
WHERE profile_updated_on IS NOT NULL
ORDER BY profile_updated_on, platform_id;

CREATE TABLE job_project_events (
    id         INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES job_projects (id),
    status     TEXT NOT NULL
               CHECK (status IN ('found', 'applied', 'assessment', 'accepted',
                                 'rejected', 'active', 'ended')),
    at         TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', at) IS at)
) STRICT;

CREATE INDEX job_project_events_by_project ON job_project_events (project_id, id);

INSERT INTO job_project_events (project_id, status, at)
SELECT id, status, status_at FROM job_projects ORDER BY id;

CREATE TABLE routine_finishes (
    day         TEXT NOT NULL CHECK (date(day) IS day),
    routine_id  TEXT NOT NULL
                CHECK (length(routine_id) BETWEEN 1 AND 31
                       AND routine_id NOT GLOB '*[^a-z0-9_]*'
                       AND substr(routine_id, 1, 1) BETWEEN 'a' AND 'z'),
    finished_at TEXT NOT NULL
                CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', finished_at) IS finished_at),
    PRIMARY KEY (day, routine_id)
) STRICT;

CREATE TABLE xp_seen (
    key             TEXT PRIMARY KEY,
    seen_level      INTEGER NOT NULL CHECK (seen_level BETWEEN 0 AND 100),
    celebrated_tier INTEGER NOT NULL DEFAULT 0 CHECK (celebrated_tier BETWEEN 0 AND 10),
    updated_at      TEXT NOT NULL
                    CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', updated_at) IS updated_at)
) STRICT;

CREATE TRIGGER platform_profile_refreshes_no_update
BEFORE UPDATE ON platform_profile_refreshes
BEGIN
    SELECT RAISE(ABORT, 'Profile refresh history is permanent and cannot be changed.');
END;

CREATE TRIGGER platform_profile_refreshes_no_delete
BEFORE DELETE ON platform_profile_refreshes
BEGIN
    SELECT RAISE(ABORT, 'Profile refresh history is permanent and cannot be deleted.');
END;

CREATE TRIGGER job_project_events_no_update
BEFORE UPDATE ON job_project_events
BEGIN
    SELECT RAISE(ABORT, 'Project history is permanent and cannot be changed.');
END;

CREATE TRIGGER job_project_events_no_delete
BEFORE DELETE ON job_project_events
BEGIN
    SELECT RAISE(ABORT, 'Project history is permanent and cannot be deleted.');
END;
