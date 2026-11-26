-- 016: Flight School: the monthly log, competency examples, skills web, study and progress.
--
-- fs_months: one row per logged month (YYYY-MM): the owner's draft dump, its status
--   (draft -> proposed -> done) and the Mission Control to-do that asked for it.
-- fs_proposals: what the model suggested from a month's dump, as JSON, waiting for the
--   owner (pending) or decided (accepted, edited, rejected). Nothing is applied until the
--   owner accepts or edits it, so every row below holds owner-approved text only.
-- fs_bullets: the month's approved log bullets.
-- fs_examples: work examples for the regulator's competencies (situation, action, outcome);
--   the per-part limits are checked in code (src/aicity/competencies.py).
-- fs_skills / fs_skill_links: the skills web: each skill's category (its colour) and level,
--   and links to related skills or to competencies it supports.
-- fs_level_events: every level change, with its evidence.
-- fs_recommendations: tasks and courses per skill; 'sent' ones became a Mission Control to-do.
-- fs_study / fs_study_target: logged study time and the weekly target's history (latest wins;
--   none means 0).
-- fs_progress: the progress check made when a month is done.
--
-- Rows are never deleted. Stamps are UTC like 2026-11-29T15:00:00Z; days are YYYY-MM-DD.

CREATE TABLE fs_months (
    month        TEXT PRIMARY KEY CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]' AND date(month || '-01') IS month || '-01'),
    draft        TEXT NOT NULL DEFAULT '' CHECK (length(draft) <= 20000),
    status       TEXT NOT NULL CHECK (status IN ('draft', 'proposed', 'done')),
    todo_task_id INTEGER REFERENCES tasks (id),
    updated_at   TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', updated_at) IS updated_at),
    done_at      TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', done_at) IS done_at)
) STRICT;

CREATE TABLE fs_proposals (
    id           INTEGER PRIMARY KEY,
    month        TEXT NOT NULL REFERENCES fs_months (month),
    kind         TEXT NOT NULL CHECK (kind IN ('bullet', 'example', 'new_skill', 'level_change',
                                               'recommendation', 'resume_change')),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    status       TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'edited', 'rejected')),
    decided_at   TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', decided_at) IS decided_at),
    created_at   TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', created_at) IS created_at),
    CHECK ((status = 'pending') = (decided_at IS NULL))
) STRICT;

CREATE TABLE fs_bullets (
    id           INTEGER PRIMARY KEY,
    month        TEXT NOT NULL REFERENCES fs_months (month),
    text         TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 300),
    links_json   TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(links_json)),
    proposal_id  INTEGER REFERENCES fs_proposals (id)
) STRICT;

CREATE TABLE fs_examples (
    id            INTEGER PRIMARY KEY,
    competency_id TEXT NOT NULL CHECK (competency_id GLOB '[1-7].[0-9]*'),
    month         TEXT REFERENCES fs_months (month),
    situation     TEXT NOT NULL CHECK (length(situation) <= 2000),
    action        TEXT NOT NULL CHECK (length(action) <= 2000),
    outcome       TEXT NOT NULL CHECK (length(outcome) <= 2000),
    status        TEXT NOT NULL CHECK (status IN ('draft', 'ready')),
    proposal_id   INTEGER REFERENCES fs_proposals (id),
    updated_at    TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', updated_at) IS updated_at)
) STRICT;

CREATE TABLE fs_skills (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE COLLATE NOCASE
               CHECK (length(name) BETWEEN 1 AND 60 AND name = trim(name)),
    category   INTEGER NOT NULL CHECK (category BETWEEN 1 AND 7),
    level      INTEGER NOT NULL CHECK (level BETWEEN 1 AND 5),
    created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', created_at) IS created_at)
) STRICT;

CREATE TABLE fs_skill_links (
    id             INTEGER PRIMARY KEY,
    skill_id       INTEGER NOT NULL REFERENCES fs_skills (id),
    other_skill_id INTEGER REFERENCES fs_skills (id),
    competency_id  TEXT CHECK (competency_id GLOB '[1-7].[0-9]*'),
    strength       REAL NOT NULL CHECK (strength BETWEEN 0 AND 1),
    -- A link goes to exactly one thing: another skill or a competency.
    CHECK ((other_skill_id IS NULL) <> (competency_id IS NULL)),
    CHECK (other_skill_id IS NULL OR other_skill_id <> skill_id)
) STRICT;

CREATE TABLE fs_level_events (
    id          INTEGER PRIMARY KEY,
    skill_id    INTEGER NOT NULL REFERENCES fs_skills (id),
    from_level  INTEGER CHECK (from_level BETWEEN 1 AND 5),
    to_level    INTEGER NOT NULL CHECK (to_level BETWEEN 1 AND 5),
    evidence    TEXT NOT NULL DEFAULT '' CHECK (length(evidence) <= 300),
    proposal_id INTEGER REFERENCES fs_proposals (id),
    at          TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', at) IS at)
) STRICT;

CREATE TABLE fs_recommendations (
    id         INTEGER PRIMARY KEY,
    skill_id   INTEGER NOT NULL REFERENCES fs_skills (id),
    kind       TEXT NOT NULL CHECK (kind IN ('task', 'course')),
    title      TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
    provider   TEXT NOT NULL DEFAULT '' CHECK (length(provider) <= 60),
    url        TEXT CHECK (url GLOB 'https://*' AND length(url) <= 500),
    price      TEXT NOT NULL DEFAULT '' CHECK (length(price) <= 40),
    free       INTEGER NOT NULL CHECK (free IN (0, 1)),
    status     TEXT NOT NULL CHECK (status IN ('open', 'done', 'dismissed', 'sent')),
    task_id    INTEGER REFERENCES tasks (id),
    created_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', created_at) IS created_at)
) STRICT;

CREATE TABLE fs_study (
    id                INTEGER PRIMARY KEY,
    day               TEXT NOT NULL CHECK (date(day) IS day),
    minutes           INTEGER NOT NULL CHECK (minutes BETWEEN 1 AND 600),
    skill_id          INTEGER REFERENCES fs_skills (id),
    recommendation_id INTEGER REFERENCES fs_recommendations (id),
    created_at        TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', created_at) IS created_at)
) STRICT;

CREATE TABLE fs_study_target (
    id               INTEGER PRIMARY KEY,
    minutes_per_week INTEGER NOT NULL CHECK (minutes_per_week BETWEEN 0 AND 3000),
    changed_at       TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', changed_at) IS changed_at)
) STRICT;

CREATE TABLE fs_progress (
    month              TEXT PRIMARY KEY REFERENCES fs_months (month),
    competencies_ready INTEGER NOT NULL CHECK (competencies_ready BETWEEN 0 AND 34),
    competencies_new   INTEGER NOT NULL CHECK (competencies_new >= 0),
    level_changes_json TEXT NOT NULL CHECK (json_valid(level_changes_json)),
    study_minutes      INTEGER NOT NULL CHECK (study_minutes >= 0),
    resume_label       TEXT CHECK (length(resume_label) BETWEEN 1 AND 40),
    made_at            TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', made_at) IS made_at)
) STRICT;

CREATE INDEX fs_proposals_pending ON fs_proposals (status, month);

CREATE TRIGGER fs_months_never_deleted
BEFORE DELETE ON fs_months
BEGIN
    SELECT RAISE(ABORT, 'Flight School rows are never deleted.');
END;

CREATE TRIGGER fs_proposals_never_deleted
BEFORE DELETE ON fs_proposals
BEGIN
    SELECT RAISE(ABORT, 'Flight School rows are never deleted.');
END;

CREATE TRIGGER fs_bullets_never_deleted
BEFORE DELETE ON fs_bullets
BEGIN
    SELECT RAISE(ABORT, 'Flight School rows are never deleted.');
END;

CREATE TRIGGER fs_examples_never_deleted
BEFORE DELETE ON fs_examples
BEGIN
    SELECT RAISE(ABORT, 'Flight School rows are never deleted.');
END;

CREATE TRIGGER fs_skills_never_deleted
BEFORE DELETE ON fs_skills
BEGIN
    SELECT RAISE(ABORT, 'Flight School rows are never deleted.');
END;

CREATE TRIGGER fs_skill_links_never_deleted
BEFORE DELETE ON fs_skill_links
BEGIN
    SELECT RAISE(ABORT, 'Flight School rows are never deleted.');
END;

CREATE TRIGGER fs_level_events_never_deleted
BEFORE DELETE ON fs_level_events
BEGIN
    SELECT RAISE(ABORT, 'Flight School rows are never deleted.');
END;

CREATE TRIGGER fs_recommendations_never_deleted
BEFORE DELETE ON fs_recommendations
BEGIN
    SELECT RAISE(ABORT, 'Flight School rows are never deleted.');
END;

CREATE TRIGGER fs_study_never_deleted
BEFORE DELETE ON fs_study
BEGIN
    SELECT RAISE(ABORT, 'Flight School rows are never deleted.');
END;

CREATE TRIGGER fs_study_target_never_deleted
BEFORE DELETE ON fs_study_target
BEGIN
    SELECT RAISE(ABORT, 'Flight School rows are never deleted.');
END;

CREATE TRIGGER fs_progress_never_deleted
BEFORE DELETE ON fs_progress
BEGIN
    SELECT RAISE(ABORT, 'Flight School rows are never deleted.');
END;
