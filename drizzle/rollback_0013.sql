-- Rollback for 0013_thankful_master_chief.sql — Phase 31, pinned output and partial runs.
--
-- Safe at any time: no row depends on the column for anything but its label. Dropping it
-- turns every recorded test run into what looks like a real one, so analytics would count
-- them again from the next page view — check how many there are first:
--
--   select count(*) from run where test is not null;
--
-- and delete them if that matters more than their history:
--
--   delete from run where test is not null;
--
-- A revision older than Phase 31 does not know `pinned` either: it strips pins from any graph
-- it saves, and — the reason it is safe — executes every node for real in every run.

ALTER TABLE "run" DROP COLUMN IF EXISTS "test";

-- And its ledger row, so a later `db:migrate` re-applies 0013 rather than believing it is done.
DELETE FROM drizzle.__drizzle_migrations
WHERE created_at = (SELECT max(created_at) FROM drizzle.__drizzle_migrations);
