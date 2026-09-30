CREATE TABLE "credential_event" (
	"id" text PRIMARY KEY NOT NULL,
	"credentialId" text,
	"workspaceId" text NOT NULL,
	"event" text NOT NULL,
	"kind" text NOT NULL,
	"label" text NOT NULL,
	"runId" text,
	"nodeId" text,
	"nodeType" text,
	"actorId" text,
	"detail" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "wrappedKey" text;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "wrapIv" text;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "wrapAuthTag" text;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "keyVersion" text;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "rotatedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "rotationCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow" ADD COLUMN "webhookTokenRotatedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "credential_event" ADD CONSTRAINT "credential_event_credentialId_credential_id_fk" FOREIGN KEY ("credentialId") REFERENCES "public"."credential"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_event" ADD CONSTRAINT "credential_event_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_event" ADD CONSTRAINT "credential_event_runId_run_id_fk" FOREIGN KEY ("runId") REFERENCES "public"."run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credential_event" ADD CONSTRAINT "credential_event_actorId_user_id_fk" FOREIGN KEY ("actorId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credential_event_workspace_idx" ON "credential_event" USING btree ("workspaceId","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "credential_event_credential_idx" ON "credential_event" USING btree ("credentialId","at" DESC NULLS LAST);