-- 009: Main-job pay from before the first statement import, checked by hand.
--
-- Pay from before Steve's first imported statement came into an account whose
-- statements can't be imported; he typed it in with "Add pay", checking each one against
-- the old statements himself. No import will ever confirm those, so this step marks them
-- "checked by hand" once: every pay not confirmed by a deposit, not removed, and dated
-- before the start of the earliest statement import. With no imports, nothing is marked.
-- Nothing in the app sets this afterwards; a hand-checked pay counts as confirmed.

ALTER TABLE main_job_payments
    ADD COLUMN hand_checked_at TEXT
    CHECK (hand_checked_at IS NULL
           OR strftime('%Y-%m-%dT%H:%M:%SZ', hand_checked_at) IS hand_checked_at);

UPDATE main_job_payments
SET hand_checked_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE deposit_id IS NULL
  AND archived_at IS NULL
  AND paid_on < (SELECT MIN(first_day) FROM statement_imports);
