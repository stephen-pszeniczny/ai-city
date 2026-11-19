-- 010: Mission Control's Daily plan. A saved plan for each week and its blocks.
--
-- A week (Monday to Sunday) is created ahead, from the fixed blocks in the settings
-- file, because the Mac is usually asleep in the morning. Steve then edits the saved
-- week; his changes are kept, even when the week is rebuilt from new settings.
--
-- The database itself refuses bad data (checks below), like the tasks table.
-- Formats (all text, so they sort and compare correctly):
--   week_start, grocery_day, day:   a calendar day, 2026-11-23 (week_start a Monday)
--   start_time, end_time:            local time to the minute, 24-hour, 09:00
--   created_at, updated_at, checked_in_at:  UTC, 2026-11-25T15:00:00Z
--
-- Block columns:
--   source        'settings' (made from a [[plan.blocks]] rule) or 'added' (by Steve)
--   settings_key  for settings blocks, "<kind>|<title>" of the rule; how a rebuild
--                 knows which rule a block came from. Null for added blocks.
--   status        planned | done | skipped (gym only) | removed (by Steve)
--                 | replaced (swapped out by a rebuild, never by Steve)
--   edited        1 once Steve changes a settings block
--
-- Nothing is ever deleted: removing a block sets its status.

CREATE TABLE plan_weeks (
    id            INTEGER PRIMARY KEY,
    week_start    TEXT NOT NULL UNIQUE
                  CHECK (date(week_start) IS week_start AND strftime('%w', week_start) = '1'),
    created_at    TEXT NOT NULL
                  CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', created_at) IS created_at),
    checked_in_at TEXT
                  CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', checked_in_at) IS checked_in_at),
    grocery_day   TEXT
                  CHECK (grocery_day IS NULL OR (
                      date(grocery_day) IS grocery_day
                      AND grocery_day BETWEEN week_start AND date(week_start, '+6 days')))
) STRICT;

CREATE TABLE plan_blocks (
    id           INTEGER PRIMARY KEY,
    week_id      INTEGER NOT NULL REFERENCES plan_weeks (id),
    day          TEXT NOT NULL CHECK (date(day) IS day),
    -- The explicit '23:59' limit matters: some SQLite versions keep '24:00' as it is.
    start_time   TEXT NOT NULL
                 CHECK (strftime('%H:%M', start_time) IS start_time AND start_time <= '23:59'),
    end_time     TEXT NOT NULL
                 CHECK (strftime('%H:%M', end_time) IS end_time AND end_time <= '23:59'),
    title        TEXT NOT NULL
                 CHECK (length(title) BETWEEN 1 AND 100 AND title = trim(title)),
    kind         TEXT NOT NULL
                 CHECK (kind IN ('work', 'commute', 'gym', 'event', 'side_work', 'build', 'other')),
    source       TEXT NOT NULL CHECK (source IN ('settings', 'added')),
    settings_key TEXT,
    status       TEXT NOT NULL DEFAULT 'planned'
                 CHECK (status IN ('planned', 'done', 'skipped', 'removed', 'replaced')),
    edited       INTEGER NOT NULL DEFAULT 0 CHECK (edited IN (0, 1)),
    created_at   TEXT NOT NULL
                 CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', created_at) IS created_at),
    updated_at   TEXT NOT NULL
                 CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', updated_at) IS updated_at),
    -- A block may not run past midnight.
    CHECK (end_time > start_time),
    -- A settings block always says which rule it came from; an added block never does.
    CHECK ((source = 'settings') = (settings_key IS NOT NULL)),
    -- Only gym is marked done or skipped.
    CHECK (status NOT IN ('done', 'skipped') OR kind = 'gym'),
    -- Only settings blocks can be "edited" (added blocks are Steve's anyway).
    CHECK (edited = 0 OR source = 'settings'),
    CHECK (updated_at >= created_at)
) STRICT;

CREATE INDEX plan_blocks_by_week ON plan_blocks (week_id, day, start_time);

-- A block's day must fall inside its own week (a CHECK can't look at another table).
CREATE TRIGGER plan_blocks_day_in_week_insert
BEFORE INSERT ON plan_blocks
WHEN NOT EXISTS (
    SELECT 1 FROM plan_weeks w
    WHERE w.id = NEW.week_id AND NEW.day BETWEEN w.week_start AND date(w.week_start, '+6 days')
)
BEGIN
    SELECT RAISE(ABORT, 'A block''s day must be inside its week.');
END;

CREATE TRIGGER plan_blocks_day_in_week_update
BEFORE UPDATE OF day, week_id ON plan_blocks
WHEN NOT EXISTS (
    SELECT 1 FROM plan_weeks w
    WHERE w.id = NEW.week_id AND NEW.day BETWEEN w.week_start AND date(w.week_start, '+6 days')
)
BEGIN
    SELECT RAISE(ABORT, 'A block''s day must be inside its week.');
END;

CREATE TRIGGER plan_blocks_never_deleted
BEFORE DELETE ON plan_blocks
BEGIN
    SELECT RAISE(ABORT, 'Plan blocks are never deleted; remove them instead.');
END;

CREATE TRIGGER plan_weeks_never_deleted
BEFORE DELETE ON plan_weeks
BEGIN
    SELECT RAISE(ABORT, 'Plan weeks are never deleted.');
END;
