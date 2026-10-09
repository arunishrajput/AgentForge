-- ---------------------------------------------------------------------------
-- Phase 39 — composition: sub-workflows, workflows as agent tools, merge.
--
-- **Three nullable columns and one partial index, additive, no backfill, nothing altered.** The
-- previous revision never reads them and keeps serving correctly while this is applied.
--
--   run.parentRunId, run.parentNodeId   the run that called this one, and the node that made the call
--                                       (a `core.call_workflow` step, or the `ai.agent` step whose tool
--                                       call it was). An id with no foreign key (D86): a run is a record
--                                       of what happened, and retention prunes parent and child on their
--                                       own workflows' schedules.
--   workflow.agentTool                  `{ name, description, fields }` when agents may call the workflow;
--                                       null (the default) when they may not (D186).
--   run_parent_idx                      a run's page lists the runs it called. Partial: almost every run
--                                       called nothing.
--
-- `core.merge`'s held arrivals are a field inside `run.cursor`'s jsonb — no column.
--
-- Rollback: `rollback_0018.sql`.
-- ---------------------------------------------------------------------------
ALTER TABLE "run" ADD COLUMN "parentRunId" text;--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "parentNodeId" text;--> statement-breakpoint
ALTER TABLE "workflow" ADD COLUMN "agentTool" jsonb;--> statement-breakpoint
CREATE INDEX "run_parent_idx" ON "run" USING btree ("parentRunId") WHERE "run"."parentRunId" is not null;