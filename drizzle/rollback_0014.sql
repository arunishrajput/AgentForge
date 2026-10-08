-- Rollback for 0014_damp_night_nurse.sql — Phase 32, the library: tags and stars.
--
-- Safe at any time for the product: no other table references these three, and a revision
-- older than Phase 32 never reads them. What it loses is every tag and every star — count
-- them first if that matters:
--
--   select (select count(*) from tag) as tags,
--          (select count(*) from workflow_tag) as tagged,
--          (select count(*) from workflow_star) as stars;
--
-- Workflows duplicated or imported by Phase 32 are ordinary workflows and are untouched.

DROP TABLE IF EXISTS "workflow_tag";
DROP TABLE IF EXISTS "workflow_star";
DROP TABLE IF EXISTS "tag";

-- And its ledger row, so a later `db:migrate` re-applies 0014 rather than believing it is done.
DELETE FROM drizzle.__drizzle_migrations
WHERE created_at = (SELECT max(created_at) FROM drizzle.__drizzle_migrations);
