-- ---------------------------------------------------------------------------
-- Phase 32 — the library: tags and stars.
--
-- **Three new tables, additive, no backfill, nothing existing altered.** The previous
-- revision never reads them and keeps serving correctly while this is applied.
--
--   tag            a workspace's tags. Unique by lower(name) within a workspace — the index
--                  is the interlock as well as the rule (D6: no transactions)
--   workflow_tag   which workflows wear which tag. Both ends cascade
--   workflow_star  one person's starred workflows. Both ends cascade
--
-- Rollback: `rollback_0014.sql`.
-- ---------------------------------------------------------------------------
CREATE TABLE "tag" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"name" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_star" (
	"userId" text NOT NULL,
	"workflowId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_star_userId_workflowId_pk" PRIMARY KEY("userId","workflowId")
);
--> statement-breakpoint
CREATE TABLE "workflow_tag" (
	"workflowId" text NOT NULL,
	"tagId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_tag_workflowId_tagId_pk" PRIMARY KEY("workflowId","tagId")
);
--> statement-breakpoint
ALTER TABLE "tag" ADD CONSTRAINT "tag_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_star" ADD CONSTRAINT "workflow_star_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_star" ADD CONSTRAINT "workflow_star_workflowId_workflow_id_fk" FOREIGN KEY ("workflowId") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tag" ADD CONSTRAINT "workflow_tag_workflowId_workflow_id_fk" FOREIGN KEY ("workflowId") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_tag" ADD CONSTRAINT "workflow_tag_tagId_tag_id_fk" FOREIGN KEY ("tagId") REFERENCES "public"."tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tag_workspace_name_idx" ON "tag" USING btree ("workspaceId",lower("name"));--> statement-breakpoint
CREATE INDEX "workflow_star_workflow_idx" ON "workflow_star" USING btree ("workflowId");--> statement-breakpoint
CREATE INDEX "workflow_tag_tag_idx" ON "workflow_tag" USING btree ("tagId");