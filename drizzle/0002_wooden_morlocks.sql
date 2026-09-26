ALTER TABLE "workflow" ADD COLUMN "webhookToken" text DEFAULT replace(gen_random_uuid()::text, '-', '') NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow" ADD COLUMN "scheduleNextAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflow" ADD COLUMN "scheduleLastFiredAt" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "workflow_schedule_due_idx" ON "workflow" USING btree ("scheduleNextAt") WHERE "workflow"."scheduleNextAt" is not null;--> statement-breakpoint
ALTER TABLE "workflow" ADD CONSTRAINT "workflow_webhookToken_unique" UNIQUE("webhookToken");