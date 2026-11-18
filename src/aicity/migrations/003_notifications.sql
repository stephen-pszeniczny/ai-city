-- 003: Notifications (the shuttle and ticker). One row per thing that needs the
-- owner's attention. For now the only kind is 'reminder': a task's reminder time
-- has arrived. Later buildings add their own kinds to the CHECK list.
--
-- Formats match 002:
--   due_at:                                       local Mac time to the minute, 2026-11-30T09:00
--   created_at, seen_at, dismissed_at, cleared_at: UTC, 2026-11-15T21:00:00Z
--
-- A notification is active until it's dismissed (the owner pressed Dismiss) or
-- cleared (its task was finished, archived, or its reminder changed). Only the
-- task's title is copied here, never its notes. Rows that have been dismissed or
-- cleared for 90 days are deleted by the reminder check.

CREATE TABLE notifications (
    id           INTEGER PRIMARY KEY,
    kind         TEXT NOT NULL CHECK (kind IN ('reminder')),
    task_id      INTEGER REFERENCES tasks (id),
    title        TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    due_at       TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M', due_at) IS due_at),
    created_at   TEXT NOT NULL
                 CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', created_at) IS created_at),
    seen_at      TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', seen_at) IS seen_at),
    dismissed_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', dismissed_at) IS dismissed_at),
    cleared_at   TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', cleared_at) IS cleared_at),
    -- A reminder always belongs to a task.
    CHECK (kind <> 'reminder' OR task_id IS NOT NULL),
    -- One reminder time can only ever make one notification.
    UNIQUE (kind, task_id, due_at)
) STRICT;

CREATE INDEX notifications_active ON notifications (dismissed_at, cleared_at, due_at);
