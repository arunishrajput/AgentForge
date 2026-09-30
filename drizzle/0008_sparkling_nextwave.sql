-- ---------------------------------------------------------------------------
-- Phase 20 — per-workflow visibility and the public share link.
--
-- **Purely additive, and every addition has a default or is nullable**, so the previous
-- revision — which knows about none of these columns — keeps serving correctly while this
-- is applied. That is deliberate and it is why Phase 20 needs one migration where Phase
-- 19A needed two: there is no narrowing half to wait for.
--
-- `visibility` defaults to `workspace`, which is precisely the behaviour every row already
-- had — every member of a workspace could see every workflow in it. So the backfill is the
-- default and there is no data migration: nothing any user can observe changes when this
-- runs.
--
-- The unique index is **partial**, and on an unauthenticated route's only query. Two
-- things follow from `where "shareToken" is not null`: an unshared workflow is not in the
-- index at all, which is most of them; and one token can name at most one workflow,
-- enforced by the database rather than by the code that mints it. `neon-http` has no
-- transactions (D6), so an index is again the only interlock available — the same argument
-- `workspace_personal_idx` and `workspace_invitation_live_idx` are built on. A plain
-- unique index would also have worked here, since Postgres permits many NULLs in one, but
-- it would carry a row per unshared workflow for nothing.
--
-- To roll back: `drizzle/rollback_0008.sql`. It drops three columns and one index and
-- loses exactly two things — which workflows were private, and any live share link. Both
-- are re-creatable by hand, which is what makes this one genuinely reversible.
-- ---------------------------------------------------------------------------

ALTER TABLE "workflow" ADD COLUMN "visibility" text DEFAULT 'workspace' NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow" ADD COLUMN "shareToken" text;--> statement-breakpoint
ALTER TABLE "workflow" ADD COLUMN "sharedAt" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_share_token_idx" ON "workflow" USING btree ("shareToken") WHERE "workflow"."shareToken" is not null;