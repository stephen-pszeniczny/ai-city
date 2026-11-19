-- 013: Mission Control's grocery list.
--
-- One row per item. Items are never deleted: taking one off the list ("remove", or
-- "clear ticked" for everything bought) sets status = 'cleared'. Adding a name that's
-- already on the list reuses that row (the app checks; see src/aicity/grocery.py).
-- Later, Training Bay's recipes can add items here too.
--
-- Formats: created_at, ticked_at, cleared_at are UTC, 2026-11-29T15:00:00Z.
-- ticked_at is set exactly while an item is ticked; cleared_at exactly once it's cleared
-- (a cleared item keeps no ticked_at).

CREATE TABLE grocery_items (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 100 AND name = trim(name)),
    status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'ticked', 'cleared')),
    created_at TEXT NOT NULL
               CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', created_at) IS created_at),
    ticked_at  TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', ticked_at) IS ticked_at),
    cleared_at TEXT CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', cleared_at) IS cleared_at),
    CHECK ((status = 'ticked') = (ticked_at IS NOT NULL)),
    CHECK ((status = 'cleared') = (cleared_at IS NOT NULL))
) STRICT;

CREATE INDEX grocery_items_by_status ON grocery_items (status, id);

CREATE TRIGGER grocery_items_never_deleted
BEFORE DELETE ON grocery_items
BEGIN
    SELECT RAISE(ABORT, 'Grocery items are never deleted; clear them instead.');
END;
