CREATE TABLE "workspace_member" (
	"workspaceId" text NOT NULL,
	"userId" text NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_member_workspaceId_userId_pk" PRIMARY KEY("workspaceId","userId")
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"createdBy" text,
	"personal" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credential" ADD COLUMN "workspaceId" text;--> statement-breakpoint
ALTER TABLE "run" ADD COLUMN "workspaceId" text;--> statement-breakpoint
ALTER TABLE "workflow_version" ADD COLUMN "workspaceId" text;--> statement-breakpoint
ALTER TABLE "workflow" ADD COLUMN "workspaceId" text;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_member" ADD CONSTRAINT "workspace_member_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_member_user_idx" ON "workspace_member" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_personal_idx" ON "workspace" USING btree ("createdBy") WHERE "workspace"."personal";--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run" ADD CONSTRAINT "run_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_version" ADD CONSTRAINT "workflow_version_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow" ADD CONSTRAINT "workflow_workspaceId_workspace_id_fk" FOREIGN KEY ("workspaceId") REFERENCES "public"."workspace"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- REPAIR, found while rehearsing this migration on 2026-09-27.
--
-- `credential_owner_kind_label_idx` is created by migration `0001` and **was absent
-- from the deployed database** — every other index that migration creates was present,
-- only this one was gone. The consequence was live and not cosmetic: `putCredential`
-- upserts with `ON CONFLICT ("ownerId", "kind", "label")`, Postgres requires a matching
-- unique index to *plan* that statement, and without it every credential write answered
-- `42P10` — a 500 on saving an API key, connecting Google, or storing a Discord
-- webhook. Reproduced on a faithful clone and confirmed against the deployed URL.
--
-- It is restored here rather than in a migration of its own because this file is where
-- it matters: the previous revision keeps serving through the deploy window and it
-- upserts on exactly this index. `0006` drops it once the new revision — which upserts
-- on the workspace index below — is the only one running.
CREATE UNIQUE INDEX IF NOT EXISTS "credential_owner_kind_label_idx" ON "credential" USING btree ("ownerId","kind","label");--> statement-breakpoint
CREATE UNIQUE INDEX "credential_workspace_kind_label_idx" ON "credential" USING btree ("workspaceId","kind","label");--> statement-breakpoint
CREATE INDEX "run_workspace_idx" ON "run" USING btree ("workspaceId","startedAt");--> statement-breakpoint
CREATE INDEX "workflow_workspace_idx" ON "workflow" USING btree ("workspaceId","updatedAt");--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Backfill — Phase 19A, step 1 of 2 (the EXPAND half of expand/contract).
--
-- Hand-written: drizzle-kit emits schema, never data, and everything below is about
-- the rows rather than the shape.
--
-- **Every column added above is deliberately nullable at this point**, even though
-- `src/db/schema.ts` declares them `notNull`. That gap is the whole point of splitting
-- the migration: this file is applied while the PREVIOUS Cloud Run revision is still
-- serving, and that revision knows nothing about `workspaceId`. A `NOT NULL` column
-- with no default would make every workflow it inserted during the deploy window fail.
-- Migration `0006` closes the gap once the new revision is the only one running.
--
-- Every statement is re-runnable. A migration that cannot be run twice cannot be
-- safely resumed after a network error halfway through, and this one runs against a
-- database holding real data.
-- ---------------------------------------------------------------------------

-- 1. One personal workspace per existing user.
--
-- The name is the user's own, because "Arunish's workspace" is what they will see in
-- the header on the very first load after this migration and "Workspace" is not a name
-- anybody chose. `split_part(email, '@', 1)` is the fallback for an account with no
-- display name; 'Personal' is the fallback for one with neither.
INSERT INTO "workspace" ("id", "name", "createdBy", "personal", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  coalesce(
    nullif(trim(u."name"), '') || '''s workspace',
    nullif(split_part(coalesce(u."email", ''), '@', 1), '') || '''s workspace',
    'Personal workspace'
  ),
  u."id",
  true,
  now(),
  now()
FROM "user" u
WHERE NOT EXISTS (
  SELECT 1 FROM "workspace" w WHERE w."createdBy" = u."id" AND w."personal"
);--> statement-breakpoint

-- 2. Each user is the owner of their own personal workspace. Membership — not
--    `workspace.createdBy` — is what every authorisation check reads, so a workspace
--    without this row would be invisible to the person it was made for.
INSERT INTO "workspace_member" ("workspaceId", "userId", "role", "createdAt")
SELECT w."id", w."createdBy", 'owner', now()
FROM "workspace" w
WHERE w."personal" AND w."createdBy" IS NOT NULL
ON CONFLICT ("workspaceId", "userId") DO NOTHING;--> statement-breakpoint

-- 3. Every pre-existing resource joins its owner's personal workspace.
--
--    `ownerId` is left exactly as it was on all four tables. It keeps its own meaning
--    — who created this, who triggered this run — and nothing below reads it as an
--    authorisation column any more.
UPDATE "workflow" t
SET "workspaceId" = w."id"
FROM "workspace" w
WHERE w."createdBy" = t."ownerId" AND w."personal" AND t."workspaceId" IS NULL;--> statement-breakpoint

UPDATE "run" t
SET "workspaceId" = w."id"
FROM "workspace" w
WHERE w."createdBy" = t."ownerId" AND w."personal" AND t."workspaceId" IS NULL;--> statement-breakpoint

UPDATE "workflow_version" t
SET "workspaceId" = w."id"
FROM "workspace" w
WHERE w."createdBy" = t."ownerId" AND w."personal" AND t."workspaceId" IS NULL;--> statement-breakpoint

UPDATE "credential" t
SET "workspaceId" = w."id"
FROM "workspace" w
WHERE w."createdBy" = t."ownerId" AND w."personal" AND t."workspaceId" IS NULL;
