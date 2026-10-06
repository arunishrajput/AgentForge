-- ---------------------------------------------------------------------------
-- Phase 26 — timers: schedules that fire, durable waits, and the active switch.
--
-- **Three columns and one partial index, all additive, no backfill.** The previous
-- revision does not know any of them exists and keeps serving correctly while this is
-- applied: it never selects them, and every default is the behaviour it already has.
--
--   run.wakeAt                 when a `waiting` run resumes. Null in every other status,
--                              and every existing run is in another status.
--   workflow.scheduleArmedFor  the due time a Cloud Tasks timer was armed for. NULL means
--                              "not armed", which is exactly true of every schedule today —
--                              the daily sweep arms them on its first tick.
--   workflow.active            whether the automatic triggers are on. DEFAULT true, so every
--                              existing workflow keeps firing as it did. On PostgreSQL 11+
--                              a non-volatile default is stored in the catalogue, so this
--                              rewrites no rows.
--   run_wake_idx               the sweep's search for a waiting run whose task was lost.
--                              Partial on status = 'waiting', which matches no row today.
--
-- Rollback: `rollback_0012.sql`. Safe only once no run is `waiting` — see that file.
-- ---------------------------------------------------------------------------
ALTER TABLE "run" ADD COLUMN "wakeAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflow" ADD COLUMN "scheduleArmedFor" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workflow" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX "run_wake_idx" ON "run" USING btree ("wakeAt") WHERE "run"."status" = 'waiting';
