-- 006: Main-job pay as its own record, typed in on payday or added from a statement.
--
-- A pay typed in by hand has no deposit yet ("not yet confirmed"). When a statement
-- deposit confirms it, deposit_id is set and net_cents becomes the deposit's amount
-- (the statement wins); paid_on keeps the typed date, so months match pay stubs.
-- Stub details are as in 005; deductions are worked out, never stored.
--
-- Existing imported main-job pay moves here, one row per main-job deposit. The old
-- main_job_pay table is left in place, unused (nothing is ever deleted).

CREATE TABLE main_job_payments (
    id          INTEGER PRIMARY KEY,
    paid_on     TEXT NOT NULL CHECK (date(paid_on) IS paid_on),
    net_cents   INTEGER NOT NULL CHECK (net_cents BETWEEN 1 AND 100000000),  -- CAD
    gross_cents INTEGER CHECK (gross_cents BETWEEN 0 AND 100000000),
    rrsp_cents  INTEGER CHECK (rrsp_cents BETWEEN 0 AND 100000000),
    match_cents INTEGER CHECK (match_cents BETWEEN 0 AND 100000000),
    notes       TEXT CHECK (length(notes) <= 500),
    deposit_id  INTEGER UNIQUE REFERENCES deposits (id),
    created_at  TEXT NOT NULL
                CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', created_at) IS created_at)
) STRICT;

CREATE INDEX main_job_payments_by_day ON main_job_payments (paid_on, id);

INSERT INTO main_job_payments
    (paid_on, net_cents, gross_cents, rrsp_cents, match_cents, notes, deposit_id, created_at)
SELECT d.posted_on, d.amount_cents, m.gross_cents, m.rrsp_cents, m.match_cents, m.notes,
       d.id, d.created_at
FROM deposits d LEFT JOIN main_job_pay m ON m.deposit_id = d.id
WHERE d.kind = 'main_job'
ORDER BY d.posted_on, d.id;

CREATE TRIGGER main_job_payments_never_deleted
BEFORE DELETE ON main_job_payments
BEGIN
    SELECT RAISE(ABORT, 'Main-job pay is never deleted.');
END;
