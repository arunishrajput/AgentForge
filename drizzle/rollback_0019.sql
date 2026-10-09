-- Rollback for 0019_access_token.sql — Phase 41, personal access tokens.
--
-- Safe for the schema at any time: nothing references this table. What it loses is every token —
-- each script holding one is answered 401 from then on, and the tokens cannot be recovered (only
-- their hashes were ever stored), so they must be created again once the revision is rolled forward.

DROP TABLE IF EXISTS "access_token";

-- And its ledger row, so a later `db:migrate` re-applies 0019 rather than believing it is done.
DELETE FROM drizzle.__drizzle_migrations
WHERE created_at = (SELECT max(created_at) FROM drizzle.__drizzle_migrations);
