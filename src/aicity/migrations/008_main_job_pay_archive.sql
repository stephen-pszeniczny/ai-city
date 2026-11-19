-- 008: Typed-in main-job pay can be removed (archived) while no statement has
-- confirmed it: a typo or a pay typed twice. The row stays (nothing is deleted);
-- it's left out of the Income app, the totals and the review's link choices.

ALTER TABLE main_job_payments
    ADD COLUMN archived_at TEXT
    CHECK (archived_at IS NULL OR strftime('%Y-%m-%dT%H:%M:%SZ', archived_at) IS archived_at);
