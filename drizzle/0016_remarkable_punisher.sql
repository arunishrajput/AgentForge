-- ---------------------------------------------------------------------------
-- Phase 37 — when things go wrong: on-error policies, the error trigger, the inbox.
--
-- **One new table and one column with a default, additive, no backfill.** The previous
-- revision never reads either and keeps serving correctly while this is applied.
--
--   inbox_item   one entry in one person's inbox — a failed run nobody was watching. A row per
--                reader, collapsed per workflow while unread by the partial unique index, so a
--                failing webhook updates one row a reader rather than filling the table. `runId`
--                cascades, so retention's prune takes an entry with its run (D177)
--   run.handled  how many failures the run's on-error policies handled. 0 for every existing
--                run, which is true: no policy could handle anything before this phase (D175)
--
-- The `handled` step status and the `error` trigger kind need no migration: `run_step.status`
-- and `run.trigger` are text, and the set of values is the application's
-- (`src/lib/engine/types.ts`). The on-error policy is a field inside the graph's `jsonb`.
--
-- Rollback: `rollback_0016.sql`.
-- ---------------------------------------------------------------------------
CREATE TABLE "inbox_item" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"userId" text NOT NULL,
	"kind" text NOT NULL,
	"workflowId" text NOT NULL,
	"runId" text,
	"detail" text,
	"count" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"readAt" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "handled" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "inbox_item" ADD CONSTRAINT "inbox_item_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_item" ADD CONSTRAINT "inbox_item_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_item" ADD CONSTRAINT "inbox_item_workflowId_workflow_id_fk" FOREIGN KEY ("workflowId") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_item" ADD CONSTRAINT "inbox_item_runId_run_id_fk" FOREIGN KEY ("runId") REFERENCES "public"."run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_item_reader_idx" ON "inbox_item" USING btree ("userId","workspaceId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_item_unread_idx" ON "inbox_item" USING btree ("userId","workflowId","kind") WHERE "inbox_item"."readAt" is null;--> statement-breakpoint
CREATE INDEX "inbox_item_run_idx" ON "inbox_item" USING btree ("runId");--> statement-breakpoint
CREATE INDEX "inbox_item_workflow_idx" ON "inbox_item" USING btree ("workflowId");