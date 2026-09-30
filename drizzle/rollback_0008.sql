-- ---------------------------------------------------------------------------
-- Rollback for migration 0008 (Phase 20 — visibility and the public share link).
--
-- Nothing references these three columns, so dropping them cannot cascade. What is lost:
--
--   visibility   every workflow becomes workspace-visible again, which is the pre-Phase-20
--                behaviour. A workflow somebody had marked private becomes visible to
--                their colleagues — so this is the one line in here worth pausing on
--   shareToken   every live share link stops working, which is the correct outcome of
--                removing the feature and is the same thing `DELETE /share` does one
--                workflow at a time
--   sharedAt     when each link was minted. Record only
--
-- The index is dropped with its column, so it needs no statement of its own. It is named
-- here anyway, because a `DROP COLUMN` that silently takes an index with it is exactly the
-- kind of thing a reader of a rollback file should not have to know.
--
-- Rehearse it on a copy before running it anywhere real — `scripts/rehearse-migration.mjs`
-- — and remove the ledger row so `drizzle-kit migrate` will re-apply the migration
-- afterwards.
-- ---------------------------------------------------------------------------

DROP INDEX IF EXISTS "workflow_share_token_idx";

ALTER TABLE "workflow" DROP COLUMN IF EXISTS "sharedAt";
ALTER TABLE "workflow" DROP COLUMN IF EXISTS "shareToken";
ALTER TABLE "workflow" DROP COLUMN IF EXISTS "visibility";

-- The ledger row, so the migration is re-appliable. `verify-schema.mjs` prints the hash
-- for 0008; delete by tag order instead if unsure.
DELETE FROM drizzle.__drizzle_migrations
WHERE created_at = (SELECT max(created_at) FROM drizzle.__drizzle_migrations);
