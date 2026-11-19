-- 012: Routines (repeating prep checklists, e.g. "Evening prep") and their reminders.
--
-- routine_ticks: one row per ticked item per day. Routines themselves live in the
-- settings file ([[routines]]); this table only remembers what's ticked. Ticks aren't
-- history: unticking deletes the row, and each day starts fresh (rows are kept by
-- date, so yesterday's never count today).
--
-- notifications gains a fourth kind, 'routine' ("Evening prep: not done yet"), and a
-- routine_id column saying which routine it's for. SQLite can't change a CHECK in
-- place, so the table is rebuilt as in 007 and 011: every row copied with its id kept.
--
-- Kinds now:
--   reminder   a task's reminder time has arrived (always has a task_id)
--   statement  last month's statement isn't imported yet
--   checkin    the coming week isn't planned yet
--   routine    a routine still has unticked items at its reminder time (always has a routine_id)

CREATE TABLE routine_ticks (
    id         INTEGER PRIMARY KEY,
    day        TEXT NOT NULL CHECK (date(day) IS day),
    routine_id TEXT NOT NULL
               CHECK (length(routine_id) BETWEEN 1 AND 31
                      AND routine_id NOT GLOB '*[^a-z0-9_]*'
                      AND substr(routine_id, 1, 1) BETWEEN 'a' AND 'z'),
    item       TEXT NOT NULL CHECK (length(item) BETWEEN 1 AND 100 AND item = trim(item)),
    ticked_at  TEXT NOT NULL
               CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', ticked_at) IS ticked_at),
    UNIQUE (day, routine_id, item)
) STRICT;

CREATE TABLE notifications_new (
    id           INTEGER PRIMARY KEY,
    kind         TEXT NOT NULL CHECK (kind IN ('reminder', 'statement', 'checkin', 'routine')),
    task_id      INTEGER REFERENCES tasks (id),
    routine_id   TEXT,
    title        TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
    due_at       TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M', due_at) IS due_at),
    created_at   TEXT NOT NULL
                 CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', created_at) IS created_at),
    seen_at      TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', seen_at) IS seen_at),
    dismissed_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', dismissed_at) IS dismissed_at),
    cleared_at   TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', cleared_at) IS cleared_at),
    -- A reminder always belongs to a task; the other kinds never do.
    CHECK (kind <> 'reminder' OR task_id IS NOT NULL),
    CHECK (kind = 'reminder' OR task_id IS NULL),
    -- A routine reminder always says which routine; the other kinds never do.
    CHECK ((kind = 'routine') = (routine_id IS NOT NULL)),
    -- One reminder time can only ever make one notification.
    UNIQUE (kind, task_id, due_at)
) STRICT;

INSERT INTO notifications_new
    (id, kind, task_id, title, due_at, created_at, seen_at, dismissed_at, cleared_at)
SELECT id, kind, task_id, title, due_at, created_at, seen_at, dismissed_at, cleared_at
FROM notifications;

DROP TABLE notifications;
ALTER TABLE notifications_new RENAME TO notifications;

CREATE INDEX notifications_active ON notifications (dismissed_at, cleared_at, due_at);

CREATE UNIQUE INDEX notifications_one_statement_a_month
    ON notifications (substr(due_at, 1, 7)) WHERE kind = 'statement';

CREATE UNIQUE INDEX notifications_one_checkin_a_week
    ON notifications (due_at) WHERE kind = 'checkin';

-- One routine reminder per routine per day.
CREATE UNIQUE INDEX notifications_one_routine_a_day
    ON notifications (routine_id, substr(due_at, 1, 10)) WHERE kind = 'routine';
