-- 017: Flight School's master resume.
--
-- fs_resume_sections / fs_resume_items: the owner's resume as ordered sections and items,
--   imported once from his Word file (after he reviews the preview). A removed item is
--   archived, never deleted. Only owner-approved text is stored.
-- fs_resume_versions: a snapshot each time the resume changes, labelled like "v5 Nov 2026"
--   (the label Opportunity Office's profile snapshots refer to).
-- fs_resume_applied: which accepted resume-change proposals have been applied, so a change
--   accepted before the import is applied once at import, and never twice.

CREATE TABLE fs_resume_sections (
    id       INTEGER PRIMARY KEY,
    position INTEGER NOT NULL CHECK (position >= 0),
    title    TEXT NOT NULL UNIQUE COLLATE NOCASE
             CHECK (length(title) BETWEEN 1 AND 60 AND title = trim(title))
) STRICT;

CREATE TABLE fs_resume_items (
    id          INTEGER PRIMARY KEY,
    section_id  INTEGER NOT NULL REFERENCES fs_resume_sections (id),
    position    INTEGER NOT NULL CHECK (position >= 0),
    text        TEXT NOT NULL CHECK (length(text) BETWEEN 1 AND 600),
    archived_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', archived_at) IS archived_at),
    updated_at  TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', updated_at) IS updated_at)
) STRICT;

CREATE TABLE fs_resume_versions (
    id            INTEGER PRIMARY KEY,
    label         TEXT NOT NULL UNIQUE CHECK (length(label) BETWEEN 1 AND 40),
    snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
    created_at    TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', created_at) IS created_at)
) STRICT;

CREATE TABLE fs_resume_applied (
    proposal_id INTEGER PRIMARY KEY REFERENCES fs_proposals (id),
    applied_at  TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', applied_at) IS applied_at)
) STRICT;

CREATE TRIGGER fs_resume_sections_never_deleted BEFORE DELETE ON fs_resume_sections
BEGIN SELECT RAISE(ABORT, 'Flight School rows are never deleted.'); END;
CREATE TRIGGER fs_resume_items_never_deleted BEFORE DELETE ON fs_resume_items
BEGIN SELECT RAISE(ABORT, 'Flight School rows are never deleted.'); END;
CREATE TRIGGER fs_resume_versions_never_deleted BEFORE DELETE ON fs_resume_versions
BEGIN SELECT RAISE(ABORT, 'Flight School rows are never deleted.'); END;
CREATE TRIGGER fs_resume_applied_never_deleted BEFORE DELETE ON fs_resume_applied
BEGIN SELECT RAISE(ABORT, 'Flight School rows are never deleted.'); END;
