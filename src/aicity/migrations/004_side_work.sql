-- 004: The Vault's side-work log, payments received, and exchange rates.
--
-- Nothing about the work itself is stored: no project, task or client details.
-- Money is whole cents; rates are exact decimal text like '1.3725'.
-- Days are calendar days (2026-03-21), checked with the same date() trick as
-- 002_tasks.sql so impossible dates are refused. Times are UTC, like tasks.
-- Entries and payments are never deleted: entries are archived instead.

CREATE TABLE side_work_payments (
    id           INTEGER PRIMARY KEY,
    kind         TEXT NOT NULL CHECK (kind IN ('pay', 'bonus')),
    company      TEXT CHECK (length(company) BETWEEN 1 AND 80 AND company = trim(company)),
    received_on  TEXT NOT NULL CHECK (date(received_on) IS received_on),
    amount_cents INTEGER NOT NULL CHECK (amount_cents BETWEEN 0 AND 100000000),
    currency     TEXT NOT NULL CHECK (currency IN ('CAD', 'USD')),
    -- The USD-to-CAD rate used for this payment and the day it's from (a weekend
    -- payment uses the last business day before). Missing until it's known.
    rate         TEXT CHECK (rate GLOB '[0-9]*.[0-9]*' AND CAST(rate AS REAL) > 0),
    rate_date    TEXT CHECK (date(rate_date) IS rate_date),
    created_at   TEXT NOT NULL
                 CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', created_at) IS created_at),
    CHECK ((rate IS NULL) = (rate_date IS NULL))
) STRICT;

CREATE TABLE side_work_entries (
    id          INTEGER PRIMARY KEY,
    worked_on   TEXT NOT NULL CHECK (date(worked_on) IS worked_on),
    -- A pay-schedule id from settings, or any company name typed in. Optional.
    company     TEXT CHECK (length(company) BETWEEN 1 AND 80 AND company = trim(company)),
    role        TEXT CHECK (length(role) BETWEEN 1 AND 80 AND role = trim(role)),
    minutes     INTEGER CHECK (minutes BETWEEN 1 AND 10080),
    rate_cents  INTEGER CHECK (rate_cents BETWEEN 0 AND 10000000),
    currency    TEXT NOT NULL CHECK (currency IN ('CAD', 'USD')),
    payment_id  INTEGER REFERENCES side_work_payments (id),
    archived    INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
    created_at  TEXT NOT NULL
                CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', created_at) IS created_at),
    updated_at  TEXT NOT NULL
                CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', updated_at) IS updated_at),
    CHECK (updated_at >= created_at)
) STRICT;

CREATE INDEX side_work_entries_by_day ON side_work_entries (worked_on, id);
CREATE INDEX side_work_entries_by_payment ON side_work_entries (payment_id);

CREATE TRIGGER side_work_entries_never_deleted
BEFORE DELETE ON side_work_entries
BEGIN
    SELECT RAISE(ABORT, 'Side-work entries are never deleted; archive them instead.');
END;

CREATE TRIGGER side_work_payments_never_deleted
BEFORE DELETE ON side_work_payments
BEGIN
    SELECT RAISE(ABORT, 'Payments are never deleted.');
END;

-- Bank of Canada daily rates (or one typed in by hand), kept so each is fetched once.
CREATE TABLE fx_rates (
    currency   TEXT NOT NULL CHECK (currency = 'USD'),
    day        TEXT NOT NULL CHECK (date(day) IS day),
    rate       TEXT NOT NULL CHECK (rate GLOB '[0-9]*.[0-9]*' AND CAST(rate AS REAL) > 0),
    source     TEXT NOT NULL CHECK (source IN ('boc', 'manual')),
    fetched_at TEXT NOT NULL
               CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', fetched_at) IS fetched_at),
    PRIMARY KEY (currency, day)
) STRICT;
