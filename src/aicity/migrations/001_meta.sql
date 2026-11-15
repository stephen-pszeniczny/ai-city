-- 001: the meta table. Holds facts about the database file itself.
-- Its most important row is db_kind ('personal' or 'sample'), written once
-- when the file is created, so the app can refuse to open the wrong file.
CREATE TABLE meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
) STRICT;
