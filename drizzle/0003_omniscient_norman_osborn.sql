ALTER TABLE "run" ADD COLUMN "mode" text DEFAULT 'sync' NOT NULL;--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "cursor" jsonb;--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "attempt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "leaseOwner" text;--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "leaseExpiresAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "cancelRequestedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "dispatchToken" text;--> statement-breakpoint
CREATE INDEX "run_lease_idx" ON "run" USING btree ("status","leaseExpiresAt");