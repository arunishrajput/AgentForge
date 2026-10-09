-- ---------------------------------------------------------------------------
-- Phase 38 — human in the loop: the approval request.
--
-- **One new table, additive, no backfill, nothing altered.** The previous revision never reads it
-- and keeps serving correctly while this is applied.
--
--   approval   one request for a person's decision, made by `core.approval` while its run waits.
--              Its link is stored only as `tokenHash` (sha256, D95's construction); a decision is a
--              compare-and-set on `status = 'pending'`. Keyed by (runId, nodeId, iteration), so an
--              attempt that re-executes the same approval replaces its token rather than asking
--              twice. Every foreign key cascades: retention's prune of a run takes its requests.
--
-- The inbox is not altered: a pending approval is read into it live, never written as an
-- `inbox_item` (D180). The cursor's `approval` marker is a field inside `run.cursor`'s jsonb.
--
-- Rollback: `rollback_0017.sql`.
-- ---------------------------------------------------------------------------
CREATE TABLE "approval" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"workflowId" text NOT NULL,
	"runId" text NOT NULL,
	"nodeId" text NOT NULL,
	"iteration" integer DEFAULT 0 NOT NULL,
	"seq" integer NOT NULL,
	"message" text NOT NULL,
	"approvers" jsonb,
	"tokenHash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"onTimeout" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"via" text,
	"decidedBy" text,
	"comment" text,
	"decidedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_workflowId_workflow_id_fk" FOREIGN KEY ("workflowId") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_runId_run_id_fk" FOREIGN KEY ("runId") REFERENCES "public"."run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "approval_decidedBy_user_id_fk" FOREIGN KEY ("decidedBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_run_node_idx" ON "approval" USING btree ("runId","nodeId","iteration");--> statement-breakpoint
CREATE INDEX "approval_pending_idx" ON "approval" USING btree ("workspaceId","createdAt") WHERE "approval"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "approval_workflow_idx" ON "approval" USING btree ("workflowId");