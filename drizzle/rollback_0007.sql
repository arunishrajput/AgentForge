-- ---------------------------------------------------------------------------
-- Rollback for migration 0007 (Phase 19B — invitations).
--
-- `workspace_invitation` is referenced by nothing: it points at `workspace` and `user`,
-- and neither points back. Dropping it loses the record of who was invited and by whom,
-- and loses nothing else — every membership an accepted invitation created is a row in
-- `workspace_member` and survives this.
--
-- Rehearse it on a copy before running it anywhere real, and remove the ledger row so
-- `drizzle-kit migrate` will re-apply the migration afterwards.
-- ---------------------------------------------------------------------------

DROP TABLE IF EXISTS "workspace_invitation";

-- The ledger row, so the migration is re-appliable. The hash is whatever
-- `scripts/verify-schema.mjs` prints for 0007; delete by tag order instead if unsure.
DELETE FROM drizzle.__drizzle_migrations
WHERE created_at = (SELECT max(created_at) FROM drizzle.__drizzle_migrations);
