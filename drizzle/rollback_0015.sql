-- Rollback for 0015_easy_punisher.sql — Phase 33, run history and recovery.
--
-- Safe at any time: nothing executes from the column. Dropping it forgets which runs were
-- re-runs and retries of which; the runs themselves, and a retry's carried-over steps, stay.
--
-- A revision older than Phase 33 does not know the `reused` step status either. It renders such
-- a step without a look of its own, and — the part that matters — a retry still `queued` or
-- `waiting` when it is rolled back would be resumed by a worker that does not read a `reused`
-- step's output. Check first, and let them finish:
--
--   select count(*) from run where origin is not null and status in ('queued', 'running', 'waiting');

ALTER TABLE "run" DROP COLUMN IF EXISTS "origin";

-- And its ledger row, so a later `db:migrate` re-applies 0015 rather than believing it is done.
DELETE FROM drizzle.__drizzle_migrations
WHERE created_at = (SELECT max(created_at) FROM drizzle.__drizzle_migrations);
