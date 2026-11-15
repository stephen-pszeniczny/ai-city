-- 002: City Hall to-do list. The tasks table and its permanent history.
--
-- The database itself refuses bad data (checks below), so a bug in the app
-- can't store an empty title, an unknown category or an impossible date.
--
-- Formats (all text, so they sort and compare correctly):
--   created_at, updated_at, completed_at, history at:  UTC, 2026-11-15T21:00:00Z
--   goal_date:    a calendar day, 2026-12-01
--   reminder_at:  local Mac time to the minute, 2026-11-30T09:00
-- Each check rebuilds the value with SQLite's date functions and requires an
-- exact match ("IS" also treats a missing value as fine). That refuses
-- impossible dates such as 2026-02-30, which SQLite would otherwise roll over.
--
-- Categories are generic IDs; display names belong in the settings file.
-- Tasks are never deleted: "delete" in the app means status = 'archived'.

CREATE TABLE tasks (
    id           INTEGER PRIMARY KEY,
    title        TEXT NOT NULL
                 CHECK (length(title) BETWEEN 1 AND 200 AND title = trim(title)),
    notes        TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 5000),
    category     TEXT NOT NULL CHECK (category IN ('work', 'side_work', 'personal', 'city')),
    goal_date    TEXT CHECK (date(goal_date) IS goal_date),
    reminder_at  TEXT CHECK (strftime('%Y-%m-%dT%H:%M', reminder_at) IS reminder_at),
    status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done', 'archived')),
    created_at   TEXT NOT NULL
                 CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', created_at) IS created_at),
    updated_at   TEXT NOT NULL
                 CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', updated_at) IS updated_at),
    completed_at TEXT
                 CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', completed_at) IS completed_at),
    -- A completion time exists exactly when the task is done.
    CHECK ((status = 'done') = (completed_at IS NOT NULL)),
    CHECK (updated_at >= created_at)
) STRICT;

CREATE INDEX tasks_by_status ON tasks (status, updated_at);

CREATE TRIGGER tasks_never_deleted
BEFORE DELETE ON tasks
BEGIN
    SELECT RAISE(ABORT, 'Tasks are never deleted; archive them instead.');
END;

-- One row per change. "changes" is a JSON object of field -> [old, new].
CREATE TABLE task_history (
    id       INTEGER PRIMARY KEY,
    task_id  INTEGER NOT NULL REFERENCES tasks (id),
    at       TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', at) IS at),
    kind     TEXT NOT NULL
             CHECK (kind IN ('created', 'edited', 'completed', 'reopened', 'archived')),
    changes  TEXT NOT NULL DEFAULT '{}'
             CHECK (json_valid(changes) AND json_type(changes) = 'object')
) STRICT;

CREATE INDEX task_history_by_task ON task_history (task_id, id);

-- History is kept indefinitely: rows can be added, never changed or removed.
CREATE TRIGGER task_history_no_update
BEFORE UPDATE ON task_history
BEGIN
    SELECT RAISE(ABORT, 'Task history is permanent and cannot be changed.');
END;

CREATE TRIGGER task_history_no_delete
BEFORE DELETE ON task_history
BEGIN
    SELECT RAISE(ABORT, 'Task history is permanent and cannot be deleted.');
END;
