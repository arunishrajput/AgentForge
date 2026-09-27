-- ---------------------------------------------------------------------------
-- ROLLBACK for migrations 0005 and 0006 — Phase 19A.
--
-- **Not run by drizzle-kit.** Drizzle has no down migrations, so this is applied by
-- hand: `psql "$DATABASE_URL_UNPOOLED" -f drizzle/rollback_0005_0006.sql`, followed by
-- deleting the two rows it names from `drizzle.__drizzle_migrations` (the last
-- statement does that too).
--
-- **Rehearse it before trusting it:** `node --env-file=.env scripts/rehearse-migration.mjs`
-- clones the affected tables into a throwaway schema, applies 0005 and 0006 forward,
-- applies this file backward, and asserts the copy is byte-for-byte where it started.
--
-- **What it does and does not undo.** It removes everything Phase 19A added: the two
-- tables, the four columns and the indexes, and it restores the credential index that
-- 0006 dropped. It does not restore data, because it destroys none — `ownerId` was
-- never touched on any of the four tables, which is exactly why this rollback is safe
-- and why `workspaceId` was added alongside `ownerId` rather than replacing it. A
-- database rolled back by this file is the database as it was before Phase 19A, with
-- every workflow, run, version and credential still attributed to its owner.
--
-- **The one thing it loses** is any workspace created after the migration and any
-- resource that belonged to a workspace other than its owner's personal one — which,
-- in Phase 19A, is nothing: every workspace is personal and every resource is in its
-- owner's. That stops being true in Phase 19B, and this file stops being a complete
-- rollback on the day it does.
-- ---------------------------------------------------------------------------

-- 1. Restore the pre-19A credential index before dropping the column it was replaced
--    by, so the table is never briefly without a uniqueness guarantee.
CREATE UNIQUE INDEX IF NOT EXISTS "credential_owner_kind_label_idx"
  ON "credential" USING btree ("ownerId", "kind", "label");

-- 2. The columns. Dropping one takes its index and its foreign key with it.
ALTER TABLE "credential" DROP COLUMN IF EXISTS "workspaceId";
ALTER TABLE "workflow_version" DROP COLUMN IF EXISTS "workspaceId";
ALTER TABLE "run" DROP COLUMN IF EXISTS "workspaceId";
ALTER TABLE "workflow" DROP COLUMN IF EXISTS "workspaceId";

-- 3. The tables. `workspace_member` first — it references `workspace`.
DROP TABLE IF EXISTS "workspace_member";
DROP TABLE IF EXISTS "workspace";

-- 4. Forget the two migrations, so a later `drizzle-kit migrate` re-applies them
--    rather than believing they are already in place. Matched on the file tag rather
--    than on a hash, because the hash changes whenever either file is edited.
DELETE FROM "drizzle"."__drizzle_migrations"
WHERE "created_at" IN (
  SELECT "created_at" FROM "drizzle"."__drizzle_migrations" ORDER BY "created_at" DESC LIMIT 2
);
