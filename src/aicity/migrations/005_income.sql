-- 005: The Vault's income import: statement imports, the deposits kept from them,
-- main-job pay details, and new payment details (deposit link, bonus, notes, extra).
--
-- Only income from known sources is kept from a statement. Never stored: the file,
-- spending rows, balances or description text. A deposit's row_key is a hash of
-- its statement row, so importing the same row again is recognised and skipped.
-- Nothing here is ever deleted.

CREATE TABLE statement_imports (
    id          INTEGER PRIMARY KEY,
    first_day   TEXT NOT NULL CHECK (date(first_day) IS first_day),
    last_day    TEXT NOT NULL CHECK (date(last_day) IS last_day),
    kept        INTEGER NOT NULL CHECK (kept >= 0),
    duplicates  INTEGER NOT NULL CHECK (duplicates >= 0),
    skipped     INTEGER NOT NULL CHECK (skipped >= 0),
    spending    INTEGER NOT NULL CHECK (spending >= 0),
    created_at  TEXT NOT NULL
                CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', created_at) IS created_at),
    CHECK (last_day >= first_day)
) STRICT;

CREATE TABLE deposits (
    id           INTEGER PRIMARY KEY,
    posted_on    TEXT NOT NULL CHECK (date(posted_on) IS posted_on),
    amount_cents INTEGER NOT NULL CHECK (amount_cents BETWEEN 1 AND 100000000),  -- CAD
    kind         TEXT NOT NULL CHECK (kind IN ('main_job', 'side_work')),
    -- 'main_job', a pay-schedule id, or a company name typed in at review.
    source       TEXT NOT NULL CHECK (length(source) BETWEEN 1 AND 80),
    row_key      TEXT NOT NULL UNIQUE CHECK (length(row_key) = 64),
    import_id    INTEGER NOT NULL REFERENCES statement_imports (id),
    created_at   TEXT NOT NULL
                 CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', created_at) IS created_at)
) STRICT;

CREATE INDEX deposits_by_day ON deposits (posted_on, id);

-- What the pay stub says, typed in by Steve (each optional). Deductions are
-- worked out as gross - net (the deposit) - RRSP contribution, never stored.
CREATE TABLE main_job_pay (
    deposit_id  INTEGER PRIMARY KEY REFERENCES deposits (id),
    gross_cents INTEGER CHECK (gross_cents BETWEEN 0 AND 100000000),
    rrsp_cents  INTEGER CHECK (rrsp_cents BETWEEN 0 AND 100000000),
    match_cents INTEGER CHECK (match_cents BETWEEN 0 AND 100000000),
    notes       TEXT CHECK (length(notes) <= 500)
) STRICT;

-- New payment details. (An "extra" is side income not tied to logged hours; it is
-- stored as a bonus-kind row with is_extra = 1, because changing the kind CHECK
-- would mean rebuilding a table other tables point at.)
ALTER TABLE side_work_payments
    ADD COLUMN deposit_id INTEGER REFERENCES deposits (id);
ALTER TABLE side_work_payments
    ADD COLUMN includes_bonus INTEGER NOT NULL DEFAULT 0 CHECK (includes_bonus IN (0, 1));
ALTER TABLE side_work_payments
    ADD COLUMN bonus_cents INTEGER
    CHECK (bonus_cents IS NULL OR (includes_bonus = 1 AND bonus_cents BETWEEN 1 AND amount_cents));
ALTER TABLE side_work_payments
    ADD COLUMN notes TEXT CHECK (length(notes) <= 500);
ALTER TABLE side_work_payments
    ADD COLUMN is_extra INTEGER NOT NULL DEFAULT 0
    CHECK (is_extra IN (0, 1) AND (is_extra = 0 OR kind = 'bonus'));

CREATE UNIQUE INDEX side_work_payments_one_per_deposit
    ON side_work_payments (deposit_id) WHERE deposit_id IS NOT NULL;

CREATE TRIGGER statement_imports_never_deleted
BEFORE DELETE ON statement_imports
BEGIN
    SELECT RAISE(ABORT, 'Statement imports are never deleted.');
END;

CREATE TRIGGER deposits_never_deleted
BEFORE DELETE ON deposits
BEGIN
    SELECT RAISE(ABORT, 'Deposits are never deleted.');
END;

CREATE TRIGGER main_job_pay_never_deleted
BEFORE DELETE ON main_job_pay
BEGIN
    SELECT RAISE(ABORT, 'Main-job pay is never deleted.');
END;
