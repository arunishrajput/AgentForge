CREATE TABLE "workflow_version" (
	"id" text PRIMARY KEY NOT NULL,
	"workflowId" text NOT NULL,
	"ownerId" text NOT NULL,
	"number" integer NOT NULL,
	"label" text,
	"name" text NOT NULL,
	"graph" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "workflowVersion" integer;--> statement-breakpoint
ALTER TABLE "workflow" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_version" ADD CONSTRAINT "workflow_version_workflowId_workflow_id_fk" FOREIGN KEY ("workflowId") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_version" ADD CONSTRAINT "workflow_version_ownerId_user_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_version_workflow_number_idx" ON "workflow_version" USING btree ("workflowId","number");--> statement-breakpoint
-- Backfill: every workflow that existed before versioning gets a version 1 holding
-- its current graph, so "restore it to how it was" is answerable for an account that
-- predates this migration rather than only for workflows created after it.
--
-- `workflow.version` already defaults to 1 above, so the numbering lines up with no
-- second update: the next save bumps to 2 and records 2.
--
-- Hand-written rather than generated. drizzle-kit emits schema, never data, and this
-- is the one statement in the migration that is about the rows rather than the shape.
-- `ON CONFLICT DO NOTHING` makes it safe to re-run.
INSERT INTO "workflow_version" ("id", "workflowId", "ownerId", "number", "label", "name", "graph", "createdAt")
SELECT gen_random_uuid()::text, "id", "ownerId", 1, 'Before versioning', "name", "graph", "updatedAt"
FROM "workflow"
ON CONFLICT ("workflowId", "number") DO NOTHING;
