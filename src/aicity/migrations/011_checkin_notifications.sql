-- 011: A third kind of notification, 'checkin': "Time for your Sunday check-in", made
-- once a week from Sunday afternoon (src/aicity/checkin_reminder.py).
--
-- Kinds now:
--   reminder   a task's reminder time has arrived (always has a task_id)
--   statement  last month's statement isn't imported yet (never has a task_id)
--   checkin    the coming week isn't planned yet (never has a task_id)
--
-- SQLite can't change a CHECK in place, so the table is rebuilt as in 007: every row
-- is copied with its id kept, the old table dropped and the new one renamed.

CREATE TABLE notifications_new (
    id           INTEGER PRIMARY KEY,
    kind         TEXT NOT NULL CHECK (kind IN ('reminder', 'statement', 'checkin')),
    task_id      INTEGER REFERENCES tasks (id),
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

-- One statement reminder a month, whatever the due day or reminder time was then.
CREATE UNIQUE INDEX notifications_one_statement_a_month
    ON notifications (substr(due_at, 1, 7)) WHERE kind = 'statement';

-- One check-in reminder per week: its moment is the Sunday before the week it plans.
-- (task_id is NULL, and NULLs never clash in the UNIQUE above, so this index does it.)
CREATE UNIQUE INDEX notifications_one_checkin_a_week
    ON notifications (due_at) WHERE kind = 'checkin';
