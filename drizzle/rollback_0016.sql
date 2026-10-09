-- Rollback for 0016_remarkable_punisher.sql — Phase 37, when things go wrong.
--
-- Safe at any time for the tables: nothing else references `inbox_item`, and a revision older
-- than Phase 37 never reads it or `run.handled`. What it loses is every inbox entry, read or not,
-- and the count of handled errors on each run — the steps that say `handled` stay.
--
-- **The graphs are the part to check first.** An on-error policy and an edge out of a node's
-- Error output are fields inside the graph's `jsonb`, so nothing here removes them, and a revision
-- older than Phase 37 strips `onError` from a policy it saves, refuses an Error edge as an unknown
-- output — so the workflow will not run until the edge is removed — and stops the run at a failure
-- the policy used to handle. Count what would change:
--
--   select count(*) from workflow where graph::text like '%"onError"%';
--
-- And a revision older than Phase 37 draws a `handled` step with no look of its own, and does not
-- know a run whose trigger is `error`. Neither is lost; both read oddly until it is rolled forward.

DROP TABLE IF EXISTS "inbox_item";
ALTER TABLE "run" DROP COLUMN IF EXISTS "handled";

-- And its ledger row, so a later `db:migrate` re-applies 0016 rather than believing it is done.
DELETE FROM drizzle.__drizzle_migrations
WHERE created_at = (SELECT max(created_at) FROM drizzle.__drizzle_migrations);
