-- Rollback for 0017_unknown_pestilence.sql — Phase 38, human in the loop.
--
-- Safe for the schema at any time: nothing else references `approval`. What it loses is every
-- request, decided or not.
--
-- **A run waiting on an approval is the part to check first.** Its cursor carries the request's id;
-- a revision older than Phase 38 does not know the marker, so when the run's timer wakes it, it would
-- resume with the approval step still `running` and nothing queued — and finish the run as succeeded
-- having done nothing after the approval. Close them first (Stop on the canvas), and count:
--
--   select count(*) from run where status = 'waiting' and cursor ? 'approval';
--
-- A graph holding `core.approval` is refused by an older revision as an unknown node type, so the
-- workflow will not run until it is rolled forward; nothing in the graph is lost:
--
--   select count(*) from workflow where graph @> '{"nodes":[{"type":"core.approval"}]}';

DROP TABLE IF EXISTS "approval";

-- And its ledger row, so a later `db:migrate` re-applies 0017 rather than believing it is done.
DELETE FROM drizzle.__drizzle_migrations
WHERE created_at = (SELECT max(created_at) FROM drizzle.__drizzle_migrations);
