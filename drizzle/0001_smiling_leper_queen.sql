CREATE TABLE "credential" (
	"id" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"authTag" text NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_step" (
	"id" text PRIMARY KEY NOT NULL,
	"runId" text NOT NULL,
	"seq" integer NOT NULL,
	"nodeId" text NOT NULL,
	"nodeType" text NOT NULL,
	"iteration" integer DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"config" jsonb,
	"input" jsonb,
	"output" jsonb,
	"branch" text,
	"logs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" text,
	"startedAt" timestamp with time zone,
	"finishedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "run" (
	"id" text PRIMARY KEY NOT NULL,
	"workflowId" text NOT NULL,
	"ownerId" text NOT NULL,
	"status" text NOT NULL,
	"trigger" text NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"error" text,
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"finishedAt" timestamp with time zone,
	"heartbeatAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow" (
	"id" text PRIMARY KEY NOT NULL,
	"ownerId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"graph" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_ownerId_user_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_step" ADD CONSTRAINT "run_step_runId_run_id_fk" FOREIGN KEY ("runId") REFERENCES "public"."run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_workflowId_workflow_id_fk" FOREIGN KEY ("workflowId") REFERENCES "public"."workflow"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_ownerId_user_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow" ADD CONSTRAINT "workflow_ownerId_user_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "credential_owner_kind_label_idx" ON "credential" USING btree ("ownerId","kind","label");--> statement-breakpoint
CREATE UNIQUE INDEX "run_step_run_seq_idx" ON "run_step" USING btree ("runId","seq");--> statement-breakpoint
CREATE INDEX "run_owner_idx" ON "run" USING btree ("ownerId","startedAt");--> statement-breakpoint
CREATE INDEX "run_workflow_idx" ON "run" USING btree ("workflowId","startedAt");--> statement-breakpoint
CREATE INDEX "run_status_idx" ON "run" USING btree ("status","heartbeatAt");--> statement-breakpoint
CREATE INDEX "workflow_owner_idx" ON "workflow" USING btree ("ownerId","updatedAt");