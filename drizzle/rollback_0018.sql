-- Rollback for 0018_cold_virginia_dare.sql — Phase 39, composition.
--
-- Safe for the schema at any time: nothing references these columns. What it loses is every
-- called run's link to the run that called it, and every workflow's agent-tool marking.
--
-- **Check three things first, because the older revision cannot do what they ask:**
--
--   -- a workflow that calls another, or lists one as an agent tool: the older revision refuses
--   -- `core.call_workflow` and `core.merge` as unknown node types, and ignores `workflow:<id>` in an
--   -- agent's tools (D160: a tool it cannot find is reported, not granted)
--   select count(*) from workflow where graph @> '{"nodes":[{"type":"core.call_workflow"}]}'
--                                    or graph @> '{"nodes":[{"type":"core.merge"}]}';
--
--   -- a run waiting with merge arrivals held: the older revision does not know `cursor.joins`, so it
--   -- would resume the run with those arrivals gone and the merge never running
--   select count(*) from run where status = 'waiting' and cursor ? 'joins';
--
-- Nothing is lost from the graphs; they run again once the revision is rolled forward.

DROP INDEX IF EXISTS "run_parent_idx";
ALTER TABLE "run" DROP COLUMN IF EXISTS "parentRunId";
ALTER TABLE "run" DROP COLUMN IF EXISTS "parentNodeId";
ALTER TABLE "workflow" DROP COLUMN IF EXISTS "agentTool";

-- And its ledger row, so a later `db:migrate` re-applies 0018 rather than believing it is done.
DELETE FROM drizzle.__drizzle_migrations
WHERE created_at = (SELECT max(created_at) FROM drizzle.__drizzle_migrations);
