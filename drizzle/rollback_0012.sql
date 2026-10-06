-- Rollback for 0012_open_queen_noir.sql — Phase 26, timers.
--
-- **Safe once no run is `waiting`, and not before.** Check first:
--
--   select count(*) from run where status = 'waiting';
--
-- A waiting run's resume time lives only in `wakeAt` and its cursor. A pre-26 revision
-- does not know the `waiting` status: it would neither resume such a run nor sweep it, so
-- the run would sit in `waiting` for ever. Cancel or finish them first —
--
--   update run set status = 'cancelled', "finishedAt" = now(),
--     error = 'Cancelled by a rollback of Phase 26.' where status = 'waiting';
--
-- Dropping the two workflow columns loses, per workflow, whether it was switched off and
-- which slot a timer was armed for. A switched-off workflow comes back **on** — its webhook
-- answers again and, once its schedule is re-derived on the next save, it fires again.
-- No credential, graph or version is touched.
--
-- Run it only to reverse a deploy, and resume the */15 cron with it: a pre-26 revision
-- fires schedules only from the tick.

DROP INDEX IF EXISTS "run_wake_idx";
ALTER TABLE "run" DROP COLUMN IF EXISTS "wakeAt";
ALTER TABLE "workflow" DROP COLUMN IF EXISTS "scheduleArmedFor";
ALTER TABLE "workflow" DROP COLUMN IF EXISTS "active";
