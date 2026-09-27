-- ---------------------------------------------------------------------------
-- Phase 19A, step 2 of 2 (the CONTRACT half of expand/contract).
--
-- **Do not apply this until the new revision is the only one serving.** Migration
-- `0005` added `workspaceId` nullable so the previous revision — which writes no such
-- column — kept working through the deploy window. This file closes that gap, and
-- from here an insert without a workspace is refused by the database rather than only
-- by the application.
--
-- It also drops `credential_owner_kind_label_idx`, superseded by
-- `credential_workspace_kind_label_idx`. Both existed between the two migrations on
-- purpose: while two revisions were serving, one wrote `ownerId` and the other wrote
-- `workspaceId`, and keeping both indexes was the only state in which neither could
-- write a duplicate. **The old one must be gone before Phase 19B lets anyone hold a
-- second workspace**, or the same kind of credential in two of their workspaces is
-- refused by an index measuring the wrong thing.
--
-- To roll back: `drizzle/rollback_0005_0006.sql`.
-- ---------------------------------------------------------------------------

-- A `SET NOT NULL` against a leftover null answers "column contains null values",
-- which is true and says nothing about what to do. This says it.
DO $$
DECLARE
  orphans text;
BEGIN
  SELECT string_agg(format('%s (%s rows)', t, n), ', ')
  INTO orphans
  FROM (
    SELECT 'workflow' AS t, count(*) AS n FROM "workflow" WHERE "workspaceId" IS NULL
    UNION ALL SELECT 'run', count(*) FROM "run" WHERE "workspaceId" IS NULL
    UNION ALL SELECT 'workflow_version', count(*) FROM "workflow_version" WHERE "workspaceId" IS NULL
    UNION ALL SELECT 'credential', count(*) FROM "credential" WHERE "workspaceId" IS NULL
  ) counts
  WHERE n > 0;

  IF orphans IS NOT NULL THEN
    RAISE EXCEPTION
      'Rows still have no workspace: %. Migration 0005 backfill did not complete — re-run it (every statement in it is idempotent) before applying 0006.',
      orphans;
  END IF;
END $$;--> statement-breakpoint
DROP INDEX "credential_owner_kind_label_idx";--> statement-breakpoint
ALTER TABLE "credential" ALTER COLUMN "workspaceId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "run" ALTER COLUMN "workspaceId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_version" ALTER COLUMN "workspaceId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow" ALTER COLUMN "workspaceId" SET NOT NULL;